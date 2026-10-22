import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT_DELETION_ERROR, accountDeletionErrorKey } from "./account-deletion-localization";

test("account deletion maps only stable API error codes and safely falls back", () => {
  for (const [key, code] of Object.entries(ACCOUNT_DELETION_ERROR)) {
    assert.equal(accountDeletionErrorKey(code), key);
  }
  assert.equal(accountDeletionErrorKey(undefined), "unknown");
  assert.equal(accountDeletionErrorKey("Пользовательский текст сервера"), "unknown");
  assert.equal(accountDeletionErrorKey("toString"), "unknown");
});
