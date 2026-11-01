import assert from "node:assert/strict";
import test from "node:test";

import { externalIdempotencyKey } from "./idempotency-key";

test("один и тот же ключ клиента у разных организаций не совпадает", () => {
  const token = "shared-env-token";
  assert.notEqual(externalIdempotencyKey("org-a", token, "2026-11-01"), externalIdempotencyKey("org-b", token, "2026-11-01"));
});

test("токены с одинаковым хвостом дают разные ключи", () => {
  assert.notEqual(
    externalIdempotencyKey("org-a", "aaaaaaaa1234", "k"),
    externalIdempotencyKey("org-a", "bbbbbbbb1234", "k"),
  );
});

test("повтор того же запроса даёт тот же ключ, токен в ключ не попадает", () => {
  const key = externalIdempotencyKey("org-a", "secret-token-value", "k");
  assert.equal(key, externalIdempotencyKey("org-a", "secret-token-value", "k"));
  assert.ok(!key.includes("secret-token-value"));
});
