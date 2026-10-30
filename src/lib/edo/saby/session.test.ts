import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { FetchLike, SabyAppSession } from "./rpc";
import { createSabyCaller, isAllowedSabyBaseUrl, normalizeSabyBaseUrl, type SabySessionStore } from "./session";

function memoryStore(initial: SabyAppSession | null = null) {
  let session = initial;
  const saves: SabyAppSession[] = [];
  const store: SabySessionStore = {
    async load() {
      return session;
    },
    async save(s) {
      session = s;
      saves.push(s);
    },
    async clear() {
      session = null;
    },
  };
  return { store, saves, current: () => session };
}

/** Заглушка Saby: вход выдаёт токены по порядку, метод отвечает 401 на «протухшие» токены. */
function fakeSaby(opts: { badTokens?: Set<string>; loginDelayMs?: number } = {}) {
  let logins = 0;
  const methodCalls: string[] = [];
  const f: FetchLike = async (url, init) => {
    if (url.endsWith("/oauth/service/")) {
      logins++;
      if (opts.loginDelayMs) await new Promise((r) => setTimeout(r, opts.loginDelayMs));
      return new Response(JSON.stringify({ access_token: `A${logins}`, token: `T${logins}` }), { status: 200 });
    }
    const token = (init.headers as Record<string, string>)["X-SBISAccessToken"];
    methodCalls.push(token);
    if (opts.badTokens?.has(token)) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Сессия истекла" }, id: 0 }), { status: 401 });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", result: { token }, id: 0 }), { status: 200 });
  };
  return { f, logins: () => logins, methodCalls };
}

const creds = { baseUrl: "https://online.saby.ru/", clientId: "c1", appSecret: "s" };

describe("createSabyCaller", () => {
  test("есть сессия в кэше — без входа; адрес методов /service/?srv=1", async () => {
    const saby = fakeSaby();
    const urls: string[] = [];
    const f: FetchLike = (url, init) => {
      urls.push(url);
      return saby.f(url, init);
    };
    const { store } = memoryStore({ accessToken: "OLD", token: "OLDT" });
    const call = createSabyCaller(creds, store, { fetchImpl: f, key: "t1" });
    assert.deepEqual(await call("СБИС.Метод", {}), { token: "OLD" });
    assert.equal(saby.logins(), 0);
    assert.deepEqual(urls, ["https://online.saby.ru/service/?srv=1"]);
  });

  test("нет сессии — один вход, сессия сохраняется", async () => {
    const saby = fakeSaby();
    const mem = memoryStore();
    const call = createSabyCaller(creds, mem.store, { fetchImpl: saby.f, key: "t2" });
    await call("СБИС.Метод", {});
    await call("СБИС.Метод", {});
    assert.equal(saby.logins(), 1);
    assert.deepEqual(mem.current(), { accessToken: "A1", token: "T1" });
  });

  test("401 — один повторный вход и повтор метода", async () => {
    const saby = fakeSaby({ badTokens: new Set(["OLD"]) });
    const mem = memoryStore({ accessToken: "OLD", token: "OLDT" });
    const call = createSabyCaller(creds, mem.store, { fetchImpl: saby.f, key: "t3" });
    assert.deepEqual(await call("СБИС.Метод", {}), { token: "A1" });
    assert.equal(saby.logins(), 1);
    assert.deepEqual(saby.methodCalls, ["OLD", "A1"]);
  });

  test("второй 401 подряд уходит наверх — третьего входа нет", async () => {
    const saby = fakeSaby({ badTokens: new Set(["OLD", "A1"]) });
    const call = createSabyCaller(creds, memoryStore({ accessToken: "OLD", token: "x" }).store, { fetchImpl: saby.f, key: "t4" });
    await assert.rejects(call("СБИС.Метод", {}), (e: Error & { httpStatus?: number }) => e.httpStatus === 401);
    assert.equal(saby.logins(), 1);
  });

  test("параллельные вызовы без сессии делят один вход", async () => {
    const saby = fakeSaby({ loginDelayMs: 20 });
    const call = createSabyCaller(creds, memoryStore().store, { fetchImpl: saby.f, key: "t5" });
    await Promise.all([call("М", {}), call("М", {}), call("М", {})]);
    assert.equal(saby.logins(), 1);
  });
});

describe("isAllowedSabyBaseUrl", () => {
  test("боевые и тестовый контуры — всегда; хвостовой слеш не мешает", () => {
    for (const url of ["https://online.saby.ru", "https://online.sbis.ru/", "https://fix-online.sbis.ru"]) {
      assert.ok(isAllowedSabyBaseUrl(url, "production"), url);
    }
    assert.equal(normalizeSabyBaseUrl(" https://online.saby.ru// "), "https://online.saby.ru");
  });

  test("локальная заглушка — только вне продакшена; чужие адреса — никогда", () => {
    assert.equal(isAllowedSabyBaseUrl("http://127.0.0.1:4555", "production"), false);
    assert.ok(isAllowedSabyBaseUrl("http://127.0.0.1:4555", "development"));
    assert.ok(isAllowedSabyBaseUrl("http://localhost:4555", "test"));
    assert.equal(isAllowedSabyBaseUrl("http://127.0.0.1", "development"), false);
    assert.equal(isAllowedSabyBaseUrl("https://evil.example.com", "development"), false);
    assert.equal(isAllowedSabyBaseUrl("http://online.saby.ru", "production"), false);
    assert.equal(isAllowedSabyBaseUrl("https://online.saby.ru.evil.com", "production"), false);
  });
});
