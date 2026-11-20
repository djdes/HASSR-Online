import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import { db } from "@/lib/db";
import { LEGAL_VERSION } from "@/lib/legal-consent";
import { issueRegistrationChallenge } from "@/lib/registration-antibot";
import { POST } from "./route";

/**
 * Невидимая проверка от ботов в окне скачивания шаблона (спека
 * blank-download-phone-autoreg-2026-11, AC5): ловушка и слишком быстрая
 * отправка отсекаются до DNS, базы, писем, уведомлений и регистрации.
 */

const original = { transaction: db.$transaction, findUser: db.user.findUnique, findFirst: db.user.findFirst };
const ENV_KEYS = ["NEXTAUTH_SECRET", "RECAPTCHA_SITE_KEY", "RECAPTCHA_SECRET_KEY", "RECAPTCHA_HOSTNAMES"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
let calls: string[];
let address = 0;

beforeEach(() => {
  calls = [];
  process.env.NEXTAUTH_SECRET = "test-secret-for-blank-route-0123456789";
  process.env.RECAPTCHA_SITE_KEY = "site-key-for-tests";
  process.env.RECAPTCHA_SECRET_KEY = "secret-key-for-tests";
  process.env.RECAPTCHA_HOSTNAMES = "wesetup.ru";
  db.$transaction = (() => { calls.push("db.$transaction"); assert.fail("no writes for bots"); }) as typeof db.$transaction;
  db.user.findUnique = (async () => { calls.push("db.user.findUnique"); return null; }) as unknown as typeof db.user.findUnique;
  db.user.findFirst = (async () => { calls.push("db.user.findFirst"); return null; }) as unknown as typeof db.user.findFirst;
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    calls.push(`fetch:${String(url)}`);
    return Response.json({ Status: 0, Answer: [{ data: "10 mx.example.com" }] });
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  mock.restoreAll();
  db.$transaction = original.transaction;
  db.user.findUnique = original.findUser;
  db.user.findFirst = original.findFirst;
});

function request(body: Record<string, unknown>, userAgent = BROWSER) {
  return new Request("https://wesetup.ru/api/public/blank-download", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `198.51.100.${++address}`, "user-agent": userAgent },
    body: JSON.stringify({ email: "bot@example.com", code: "hygiene", format: "pdf", consent: true, ...body }),
  });
}

test("ловушка заполнена: ответ похож на успех, ссылка без токена, следов нет", async () => {
  const response = await POST(request({ website: "https://spam.example", elapsedMs: 9000, register: true, phone: "+79851234567" }));
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  assert.equal(data.ok, true);
  assert.equal(data.account, null, "кабинет не создаётся");
  assert.equal(data.url, "/api/journal-samples/hygiene/pdf", "ссылка без подписи — ведёт обратно на страницу журнала");
  assert.deepEqual(calls, [], "ни DNS, ни базы, ни регистрации");
});

test("слишком быстрая отправка или прямой запрос без замера — мягкая ошибка too_fast без побочных эффектов", async () => {
  for (const extra of [{ website: "", elapsedMs: 300 }, {}]) {
    const response = await POST(request(extra));
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as Record<string, unknown>).errorCode, "too_fast");
  }
  assert.deepEqual(calls, []);
});

test("кривой телефон отклоняется до проверок и записи", async () => {
  const response = await POST(request({ website: "", elapsedMs: 5000, phone: "12-34" }));
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as Record<string, unknown>).errorCode, "invalid_phone");
  assert.deepEqual(calls, []);
});

// Капча только для подозрительных (спека blank-download-seal-cover-captcha-2026-11-20).
test("без отметки времени — «Я не робот» до любых побочных эффектов (окно и запомненная почта)", async () => {
  for (const extra of [{ elapsedMs: 5000 }, { remembered: true, consentVersion: LEGAL_VERSION }]) {
    const response = await POST(request(extra));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).errorCode, "captcha_required");
  }
  // Подпись браузера в кавычках (атака 18.11) — тоже, даже с верной отметкой.
  const stamp = issueRegistrationChallenge({ now: Date.now() - 5000 })!.token;
  const quoted = await POST(request({ elapsedMs: 5000, stamp }, `"${BROWSER}"`));
  assert.equal((await quoted.json()).errorCode, "captcha_required");
  assert.deepEqual(calls, []);
});

test("нужна проверка, а ключей Google нет — 503 без побочных эффектов", async () => {
  delete process.env.RECAPTCHA_SITE_KEY;
  const response = await POST(request({ elapsedMs: 5000 }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).errorCode, "captcha_unavailable");
  assert.deepEqual(calls, []);
});

test("верная отметка и обычный браузер — проверка пройдена без Google, дальше почта и согласие", async () => {
  const stamp = issueRegistrationChallenge({ now: Date.now() - 5000 })!.token;
  const response = await POST(request({ elapsedMs: 5000, website: "", stamp }));
  assert.notEqual((await response.json()).errorCode, "captcha_required");
  assert.ok(calls.some((call) => call.startsWith("fetch:")), "дошли до проверки домена почты");
  assert.ok(calls.includes("db.$transaction"), "дошли до записи согласия");
  assert.ok(!calls.some((call) => call.includes("recaptcha")), "Google не спрашивали");
});
