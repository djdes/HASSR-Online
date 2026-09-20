import assert from "node:assert/strict";
import test from "node:test";

import { createRateLimiter } from "@/lib/rate-limit";

test("успешное действие возвращает попытку, неудачные исчерпывают лимит", () => {
  const limiter = createRateLimiter({ tokensPerInterval: 3, intervalMs: 60_000 });
  // Вся смена входит с одного IP: пять успешных входов подряд не должны упереться в лимит 3.
  for (let i = 0; i < 5; i += 1) {
    assert.equal(limiter.consume("ip"), true);
    limiter.refund("ip");
  }
  // Перебор паролей — без возврата — лимит срабатывает.
  assert.equal(limiter.consume("ip"), true);
  assert.equal(limiter.consume("ip"), true);
  assert.equal(limiter.consume("ip"), true);
  assert.equal(limiter.consume("ip"), false);
});

test("возврат не поднимает лимит выше исходного и не трогает чужие ключи", () => {
  const limiter = createRateLimiter({ tokensPerInterval: 2, intervalMs: 60_000 });
  limiter.refund("никогда-не-входил");
  limiter.refund("ip");
  assert.equal(limiter.consume("ip"), true);
  assert.equal(limiter.consume("ip"), true);
  assert.equal(limiter.consume("ip"), false);
});
