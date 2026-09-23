import assert from "node:assert/strict";
import test from "node:test";

import { decidePinGate } from "@/lib/qr-pin-gate";

/**
 * Единое правило для всех QR-журналов: PIN — ДО формы. Если PIN нужен, а
 * его нет — экран «Запросить доступ», а не ошибка после ввода данных.
 */
const base = { mode: "public" as const, hasPin: false, sessionVerified: false, passValid: false };

test("public без PIN — форма сразу", () => {
  assert.equal(decidePinGate(base), "open");
});

test("у сотрудника есть PIN — сначала PIN, после пропуска — форма", () => {
  assert.equal(decidePinGate({ ...base, hasPin: true }), "pin");
  assert.equal(decidePinGate({ ...base, hasPin: true, passValid: true }), "open");
});

test("режим pin или обязательный PIN журнала без PIN — запрос доступа", () => {
  assert.equal(decidePinGate({ ...base, mode: "pin" }), "no-pin");
  assert.equal(decidePinGate({ ...base, requirePin: true }), "no-pin");
  assert.equal(decidePinGate({ ...base, requirePin: true, hasPin: true }), "pin");
});

test("вход в кабинет (auth) и страница результата — без PIN", () => {
  assert.equal(decidePinGate({ ...base, mode: "auth", hasPin: true, sessionVerified: true }), "open");
  assert.equal(decidePinGate({ ...base, hasPin: true, isResultPage: true }), "open");
});

test("«только после входа» + вход комиссии по PIN без сессии — PIN обязателен; с сессией — как было", () => {
  const auth = { ...base, mode: "auth" as const, commissionOnly: true };
  assert.equal(decidePinGate({ ...auth, hasPin: true }), "pin");
  assert.equal(decidePinGate(auth), "no-pin");
  assert.equal(decidePinGate({ ...auth, hasPin: true, passValid: true }), "open");
  assert.equal(decidePinGate({ ...auth, hasPin: true, sessionVerified: true }), "open");
  // Обычный вход по кабинету (не «Я член комиссии») — без PIN, как раньше.
  assert.equal(decidePinGate({ ...base, mode: "auth", hasPin: true, requirePin: true }), "open");
});
