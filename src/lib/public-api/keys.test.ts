import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
  looksLikeLegacyOrgToken,
} from "./keys";

test("generateApiKey: wsk_ + 43 символа base64url, хеш = sha256(secret), префикс = 12 первых символов", () => {
  const k = generateApiKey();
  assert.match(k.secret, /^wsk_[A-Za-z0-9_-]{43}$/);
  assert.equal(k.tokenHash, crypto.createHash("sha256").update(k.secret).digest("hex"));
  assert.equal(k.displayPrefix, k.secret.slice(0, 12));
  assert.equal(hashApiKey(k.secret), k.tokenHash);
});

test("generateApiKey: два вызова дают разные ключи", () => {
  assert.notEqual(generateApiKey().secret, generateApiKey().secret);
});

test("looksLikeApiKey отвергает старый ключ организации и мусор; looksLikeLegacyOrgToken его узнаёт", () => {
  const legacy = "a".repeat(64);
  assert.equal(looksLikeApiKey(legacy), false);
  assert.equal(looksLikeLegacyOrgToken(legacy), true);
  assert.equal(looksLikeApiKey(""), false);
  assert.equal(looksLikeApiKey("wsk_" + "x".repeat(42)), false);
  assert.equal(looksLikeApiKey("wsk_" + "x".repeat(43)), true);
});
