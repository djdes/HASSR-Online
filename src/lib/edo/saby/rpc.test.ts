import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  describeSabyError,
  isSabyAppLoginError,
  isTransientSabyError,
  sabyAppLogin,
  sabyAppLogout,
  sabyRpc,
  SabyRpcError,
  type FetchLike,
} from "./rpc";

type Call = { url: string; init: RequestInit };

/** Подставной fetch: запоминает вызовы и отдаёт заранее заданный ответ. */
function stubFetch(respond: () => Response | Promise<Response>): { f: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return respond();
  };
  return { f, calls };
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

async function rejection(p: Promise<unknown>): Promise<SabyRpcError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof SabyRpcError, `ожидали SabyRpcError, получили ${String(e)}`);
    return e;
  }
  throw new Error("ожидали отказ, а промис выполнился");
}

const URL = "https://online.saby.ru/service/?srv=1";

describe("sabyRpc", () => {
  test("шлёт JSON-RPC с токеном доступа и возвращает result", async () => {
    const { f, calls } = stubFetch(json({ jsonrpc: "2.0", result: { ok: 1 }, id: 0 }));
    assert.deepEqual(await sabyRpc(URL, "СБИС.ПрочитатьДокумент", { a: 1 }, { accessToken: "S", fetchImpl: f }), { ok: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, URL);
    assert.equal(calls[0].init.method, "POST");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["X-SBISAccessToken"], "S");
    assert.equal(headers["Content-Type"], "application/json-rpc;charset=utf-8");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { jsonrpc: "2.0", method: "СБИС.ПрочитатьДокумент", params: { a: 1 }, id: 0 });
  });

  test("без токена заголовок доступа не отправляется", async () => {
    const { f, calls } = stubFetch(json({ jsonrpc: "2.0", result: "ok", id: 0 }));
    await sabyRpc(URL, "СБИС.Метод", {}, { fetchImpl: f });
    assert.equal((calls[0].init.headers as Record<string, string>)["X-SBISAccessToken"], undefined);
  });

  test("ошибка JSON-RPC → код classid, текст и подробности", async () => {
    const { f } = stubFetch(json({ jsonrpc: "2.0", error: { code: -32000, message: "Нет прав", details: "Запрещено", data: { classid: "{X}" } }, id: 0 }));
    const e = await rejection(sabyRpc(URL, "СБИС.Метод", {}, { fetchImpl: f }));
    assert.equal(e.code, "{X}");
    assert.equal(e.message, "Нет прав");
    assert.equal(e.details, "Запрещено");
    assert.equal(e.httpStatus, 200);
  });

  test("без classid код берётся из error.code", async () => {
    const { f } = stubFetch(json({ jsonrpc: "2.0", error: { code: -32602, message: "Неверные параметры" }, id: 0 }));
    assert.equal((await rejection(sabyRpc(URL, "СБИС.Метод", {}, { fetchImpl: f }))).code, "-32602");
  });

  test("HTTP 401 с телом: статус сохраняется, причина — из тела", async () => {
    const { f } = stubFetch(json({ jsonrpc: "2.0", error: { code: -32000, message: "Сессия не найдена" }, id: 0 }, 401));
    const e = await rejection(sabyRpc(URL, "СБИС.Метод", {}, { fetchImpl: f }));
    assert.equal(e.httpStatus, 401);
    assert.match(e.message, /Сессия не найдена/);
  });

  test("ответ без result и error, не JSON при 200 → bad_response; не JSON при 502 → http_502", async () => {
    assert.equal((await rejection(sabyRpc(URL, "М", {}, { fetchImpl: stubFetch(json({ id: 0 })).f }))).code, "bad_response");
    assert.equal((await rejection(sabyRpc(URL, "М", {}, { fetchImpl: stubFetch(() => new Response("<html>", { status: 200 })).f }))).code, "bad_response");
    const e = await rejection(sabyRpc(URL, "М", {}, { fetchImpl: stubFetch(() => new Response("<html>", { status: 502 })).f }));
    assert.equal(e.code, "http_502");
    assert.ok(isTransientSabyError(e));
  });

  test("таймаут → SabyRpcError timeout (временный сбой)", async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const e = await rejection(sabyRpc(URL, "М", {}, { fetchImpl: hang, timeoutMs: 20 }));
    assert.equal(e.code, "timeout");
    assert.ok(isTransientSabyError(e));
  });
});

describe("sabyAppLogin / sabyAppLogout", () => {
  const creds = { baseUrl: "https://online.saby.ru/", clientId: "123", appSecret: "SECRET-KEY" };

  test("вход отдаёт access_token и token; адрес без двойного слеша", async () => {
    const { f, calls } = stubFetch(json({ access_token: "A", sid: "S", token: "T" }));
    assert.deepEqual(await sabyAppLogin(creds, f), { accessToken: "A", token: "T" });
    assert.equal(calls[0].url, "https://online.saby.ru/oauth/service/");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { app_client_id: "123", app_secret: "SECRET-KEY" });
  });

  test("один токен годится на обе роли", async () => {
    assert.deepEqual(await sabyAppLogin(creds, stubFetch(json({ token: "T" })).f), { accessToken: "T", token: "T" });
  });

  test("4xx → неверные ключи, причина Saby без защищённого ключа", async () => {
    const { f } = stubFetch(json({ error: "Не удалось осуществить авторизацию. [0] (ОПИСАНИЕ: Приложение SECRET-KEY не найдено!)" }, 400));
    const e = await rejection(sabyAppLogin(creds, f));
    assert.ok(isSabyAppLoginError(e));
    assert.equal(e.details, "Приложение *** не найдено!");
    assert.doesNotMatch(e.message, /SECRET-KEY/);
    assert.match(describeSabyError(e), /проверьте ID подключения и защищённый ключ/);
    assert.equal(isTransientSabyError(e), false);
  });

  test("ответ без токена — тоже неверные ключи; 503 и 429 — временные", async () => {
    assert.ok(isSabyAppLoginError(await rejection(sabyAppLogin(creds, stubFetch(json({ sid: "S" })).f))));
    const e503 = await rejection(sabyAppLogin(creds, stubFetch(json({}, 503)).f));
    assert.equal(e503.code, "http_503");
    assert.ok(isTransientSabyError(e503));
    const e429 = await rejection(sabyAppLogin(creds, stubFetch(json({}, 429)).f));
    assert.ok(isTransientSabyError(e429));
    assert.match(describeSabyError(e429), /частоту запросов/);
  });

  test("выход шлёт event: exit и глотает любой сбой", async () => {
    const { f, calls } = stubFetch(json({}));
    await sabyAppLogout("https://online.saby.ru", "T", f);
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { event: "exit", token: "T" });
    await sabyAppLogout("https://online.saby.ru", "T", async () => {
      throw new TypeError("network");
    });
  });
});

describe("describeSabyError", () => {
  test("сетевой сбой и ответ по существу", () => {
    assert.match(describeSabyError(new TypeError("ECONNREFUSED")), /Нет связи с Saby/);
    assert.equal(describeSabyError(new SabyRpcError(200, "{X}", "Нет прав", "Запрещено")), "Ошибка Saby: Нет прав — Запрещено");
    assert.ok(isTransientSabyError(new TypeError("x")));
  });
});
