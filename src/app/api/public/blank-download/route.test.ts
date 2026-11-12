import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import { db } from "@/lib/db";
import { POST } from "./route";

/**
 * Невидимая проверка от ботов в окне скачивания шаблона (спека
 * blank-download-phone-autoreg-2026-11, AC5): ловушка и слишком быстрая
 * отправка отсекаются до DNS, базы, писем, уведомлений и регистрации.
 */

const original = { transaction: db.$transaction, findUser: db.user.findUnique, findFirst: db.user.findFirst };
let calls: string[];
let address = 0;

beforeEach(() => {
  calls = [];
  db.$transaction = (() => { calls.push("db.$transaction"); assert.fail("no writes for bots"); }) as typeof db.$transaction;
  db.user.findUnique = (async () => { calls.push("db.user.findUnique"); return null; }) as unknown as typeof db.user.findUnique;
  db.user.findFirst = (async () => { calls.push("db.user.findFirst"); return null; }) as unknown as typeof db.user.findFirst;
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    calls.push(`fetch:${String(url)}`);
    return Response.json({ Status: 0, Answer: [{ data: "10 mx.example.com" }] });
  });
});

afterEach(() => {
  mock.restoreAll();
  db.$transaction = original.transaction;
  db.user.findUnique = original.findUser;
  db.user.findFirst = original.findFirst;
});

function request(body: Record<string, unknown>) {
  return new Request("https://wesetup.ru/api/public/blank-download", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `198.51.100.${++address}` },
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
