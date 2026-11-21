import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHECKS,
  EMPTY_STATE,
  evaluateHealth,
  formatAlert,
  nextState,
  runCheck,
  sendTelegram,
  summarize,
} from "../../scripts/monitor/prod-check.mjs";

/**
 * Проверка прода из облака (спека cloud-testing-2026-11-21, AC3): повторы на сетевые сбои из-за
 * рубежа, тревога только со второго подряд упавшего запуска и одно сообщение о восстановлении.
 */

const BASE = "https://wesetup.ru";
const MASTER = "230e9e70954615d259fbf9a5305abff91f5e9cc0";
const noSleep = async () => undefined;

type Reply = { status: number; body: string } | Error;

function fakeFetch(replies: Reply[]) {
  const calls: string[] = [];
  const impl = async (url: URL | string) => {
    calls.push(String(url));
    const next = replies.length > 1 ? replies.shift()! : replies[0];
    if (next instanceof Error) throw next;
    return new Response(next.body, { status: next.status });
  };
  return { impl, calls };
}

const tlsError = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });

describe("evaluateHealth", () => {
  const now = new Date("2026-11-21T20:00:00Z");

  it("ok when the database answers and the version is master's", () => {
    const result = evaluateHealth(JSON.stringify({ ok: true, db: "ok", buildSha: "230e9e7" }), { masterSha: MASTER, masterCommittedAt: "2026-11-21T18:00:00Z", now });
    assert.equal(result.kind, "ok");
    assert.match(result.detail, /230e9e7/);
  });

  it("a deploy under an hour old is still in progress, not a failure", () => {
    const result = evaluateHealth({ ok: true, db: "ok", buildSha: "1111111" }, { masterSha: MASTER, masterCommittedAt: "2026-11-21T19:30:00Z", now });
    assert.equal(result.kind, "ok");
    assert.match(result.detail, /идёт/);
  });

  it("production more than an hour behind master is stale", () => {
    const result = evaluateHealth({ ok: true, db: "ok", buildSha: "1111111" }, { masterSha: MASTER, masterCommittedAt: "2026-11-21T18:30:00Z", now });
    assert.equal(result.kind, "stale");
    assert.match(result.detail, /1111111.*230e9e7.*90 мин/);
  });

  it("an unknown version skips the freshness check", () => {
    assert.equal(evaluateHealth({ ok: true, db: "ok", buildSha: "unknown" }, { masterSha: MASTER, masterCommittedAt: "2026-11-01T00:00:00Z", now }).kind, "ok");
  });

  it("a failed database is a health failure; garbage is a content failure", () => {
    assert.equal(evaluateHealth({ ok: false, db: "fail" }).kind, "health");
    assert.equal(evaluateHealth("<html>").kind, "content");
  });
});

describe("runCheck", () => {
  const home = CHECKS.find((c: { id: string }) => c.id === "home")!;

  it("retries network failures until the page answers", async () => {
    const { impl, calls } = fakeFetch([tlsError(), tlsError(), { status: 200, body: "<title>Журналы — WeSetup</title>" }]);
    const result = await runCheck(home, { baseUrl: BASE, fetchImpl: impl, sleep: noSleep });
    assert.equal(result.kind, "ok");
    assert.equal(result.attempts, 3);
    assert.equal(calls.length, 3);
    assert.equal(calls[0], "https://wesetup.ru/");
  });

  it("no answer in all attempts is a network result", async () => {
    const { impl, calls } = fakeFetch([tlsError()]);
    const result = await runCheck(home, { baseUrl: BASE, fetchImpl: impl, sleep: noSleep, attempts: 4 });
    assert.equal(result.kind, "network");
    assert.equal(calls.length, 4);
    assert.match(result.detail, /ECONNRESET/);
  });

  it("the server's own bad answer beats timeouts", async () => {
    const { impl } = fakeFetch([tlsError(), { status: 502, body: "Bad Gateway" }, tlsError()]);
    const result = await runCheck(home, { baseUrl: BASE, fetchImpl: impl, sleep: noSleep, attempts: 3 });
    assert.equal(result.kind, "http");
    assert.match(result.detail, /502/);
  });

  it("a page without its marker is a content failure", async () => {
    const { impl } = fakeFetch([{ status: 200, body: "<title>Ошибка</title>" }]);
    const result = await runCheck(home, { baseUrl: BASE, fetchImpl: impl, sleep: noSleep, attempts: 2 });
    assert.equal(result.kind, "content");
  });

  it("checks every key page", () => {
    assert.deepEqual(
      CHECKS.map((c: { path: string }) => c.path),
      ["/api/health", "/", "/login", "/robots.txt", "/sitemap.xml"],
    );
  });
});

describe("summarize", () => {
  const ok = (path: string) => ({ id: path, path, kind: "ok", detail: "200", attempts: 1 });
  const net = (path: string) => ({ id: path, path, kind: "network", detail: "нет ответа", attempts: 6 });

  it("a network miss while other pages answered is noise", () => {
    const summary = summarize([ok("/"), net("/login"), ok("/robots.txt")]);
    assert.equal(summary.status, "ok");
    assert.equal(summary.reason, "noise");
    assert.equal(summary.noise.length, 1);
  });

  it("nothing answering at all is a failure", () => {
    const summary = summarize([net("/"), net("/login")]);
    assert.equal(summary.status, "fail");
    assert.equal(summary.reason, "unreachable");
  });

  it("a real bad answer fails the run", () => {
    const summary = summarize([ok("/"), { id: "login", path: "/login", kind: "http", detail: "ответ 502", attempts: 6 }, net("/sitemap.xml")]);
    assert.equal(summary.status, "fail");
    assert.equal(summary.reason, "answer");
    assert.equal(summary.failures.length, 1);
  });
});

describe("nextState", () => {
  const fail = { status: "fail" as const, reason: "answer", failures: [], noise: [] };
  const okRun = { status: "ok" as const, reason: "clean", failures: [], noise: [] };
  const t = (minutes: number) => new Date(Date.UTC(2026, 10, 21, 20, minutes));

  it("one failed run is not an alert yet; the second in a row is, once", () => {
    const first = nextState(EMPTY_STATE, fail, t(0));
    assert.equal(first.alert, null);
    assert.equal(first.state.consecutiveFailures, 1);
    const second = nextState(first.state, fail, t(15));
    assert.equal(second.alert, "down");
    assert.equal(second.state.incident, true);
    assert.equal(second.state.firstFailureAt, t(0).toISOString());
    const third = nextState(second.state, fail, t(30));
    assert.equal(third.alert, null);
    assert.equal(third.state.consecutiveFailures, 3);
  });

  it("recovery after an alert is reported with the start of the outage", () => {
    const down = nextState(nextState(EMPTY_STATE, fail, t(0)).state, fail, t(15));
    const up = nextState(down.state, okRun, t(30));
    assert.equal(up.alert, "up");
    assert.equal(up.downSince, t(0).toISOString());
    assert.deepEqual({ ...up.state }, { ...EMPTY_STATE, lastStatus: "ok" });
  });

  it("a single blip produces no messages at all", () => {
    const blip = nextState(EMPTY_STATE, fail, t(0));
    const back = nextState(blip.state, okRun, t(15));
    assert.equal(blip.alert, null);
    assert.equal(back.alert, null);
  });

  it("a missing or broken state file starts clean", () => {
    assert.equal(nextState(undefined, fail, t(0)).state.consecutiveFailures, 1);
  });
});

describe("formatAlert", () => {
  it("names the pages, what is wrong and the Moscow start time", () => {
    const summary = summarize([{ id: "login", path: "/login", kind: "http", detail: "ответ 502", attempts: 6 }]);
    const text = formatAlert("down", {
      summary,
      state: { consecutiveFailures: 2, incident: true, firstFailureAt: "2026-11-21T20:00:00Z", lastStatus: "fail" },
      baseUrl: BASE,
      runUrl: "https://github.com/x/y/actions/runs/1",
    });
    assert.match(text, /wesetup\.ru: сбой \(2 проверки подряд, с 23:00 МСК\)/);
    assert.match(text, /— \/login: ответ 502/);
    assert.match(text, /actions\/runs\/1/);
  });

  it("unreachable from abroad says it may be the link, not the site", () => {
    const summary = summarize([{ id: "home", path: "/", kind: "network", detail: "нет ответа", attempts: 6 }]);
    const text = formatAlert("down", { summary, state: { consecutiveFailures: 2, incident: true, firstFailureAt: "2026-11-21T20:00:00Z", lastStatus: "fail" }, baseUrl: BASE });
    assert.match(text, /не отвечает из-за рубежа \(2 проверки подряд/);
    assert.match(text, /связь с зарубежьем/);
  });

  it("recovery tells how long it lasted", () => {
    const text = formatAlert("up", { summary: summarize([]), state: EMPTY_STATE, downSince: "2026-11-21T20:00:00Z", baseUrl: BASE, now: new Date("2026-11-21T20:35:00Z") });
    assert.match(text, /wesetup\.ru снова в порядке/);
    assert.match(text, /около 35 мин/);
  });
});

describe("sendTelegram", () => {
  it("does nothing without a token", async () => {
    assert.deepEqual(await sendTelegram({ token: "", chatId: "1", text: "x" }), { sent: false, reason: "no token/chat" });
  });

  it("posts the text to the chat", async () => {
    const bodies: string[] = [];
    const impl = async (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      return new Response("{}", { status: 200 });
    };
    const result = await sendTelegram({ token: "t", chatId: "42", text: "привет", fetchImpl: impl, wait: noSleep });
    assert.deepEqual(result, { sent: true });
    assert.deepEqual(JSON.parse(bodies[0]), { chat_id: "42", text: "привет", disable_web_page_preview: true });
  });
});
