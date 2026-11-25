import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  verifyTelegramContactResponse,
  verifyTelegramInitData,
} from "@/lib/telegram-init-data";

const BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";

function signWebAppParams(
  entries: Record<string, string>,
  botToken: string = BOT_TOKEN
): string {
  const params = new URLSearchParams(entries);
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const hash = crypto
    .createHmac("sha256", secretKey)
    .update(pairs.join("\n"))
    .digest("hex");
  params.set("hash", hash);
  return params.toString();
}

test("verifyTelegramInitData accepts valid signed initData", () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = signWebAppParams({
    auth_date: String(nowSec),
    query_id: "AAEAAAE",
    user: JSON.stringify({ id: 777001, first_name: "Ivan", username: "ivan" }),
  });

  const result = verifyTelegramInitData(payload, BOT_TOKEN);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.user.id, 777001);
    assert.equal(result.data.user.first_name, "Ivan");
    assert.equal(result.data.queryId, "AAEAAAE");
    assert.equal(result.data.authDate.getTime(), nowSec * 1000);
  }
});

test("verifyTelegramInitData rejects missing token, tampered hash, stale auth_date, and missing user", () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const valid = signWebAppParams({
    auth_date: String(nowSec),
    user: JSON.stringify({ id: 101 }),
  });

  assert.deepEqual(verifyTelegramInitData(valid, ""), {
    ok: false,
    error: "missing-token",
  });

  const tampered = valid.replace("101", "102");
  assert.deepEqual(verifyTelegramInitData(tampered, BOT_TOKEN), {
    ok: false,
    error: "bad-signature",
  });

  const staleSec = nowSec - 25 * 60 * 60;
  const stale = signWebAppParams({
    auth_date: String(staleSec),
    user: JSON.stringify({ id: 101 }),
  });
  assert.deepEqual(verifyTelegramInitData(stale, BOT_TOKEN), {
    ok: false,
    error: "stale",
  });

  const missingUser = signWebAppParams({ auth_date: String(nowSec) });
  assert.deepEqual(verifyTelegramInitData(missingUser, BOT_TOKEN), {
    ok: false,
    error: "missing-user",
  });
});

test("verifyTelegramContactResponse accepts valid signed contact payload", () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = signWebAppParams({
    auth_date: String(nowSec),
    contact: JSON.stringify({
      phone_number: "+79991234567",
      user_id: 777001,
      first_name: "Ivan",
      last_name: "Petrov",
    }),
  });

  const result = verifyTelegramContactResponse(payload, BOT_TOKEN);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data.contact, {
      phone_number: "+79991234567",
      user_id: 777001,
      first_name: "Ivan",
      last_name: "Petrov",
    });
    assert.equal(result.data.authDate.getTime(), nowSec * 1000);
  }
});

test("verifyTelegramContactResponse rejects tampered hash and stale auth_date (>15 min default)", () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const valid = signWebAppParams({
    auth_date: String(nowSec),
    contact: JSON.stringify({ phone_number: "+79991234567", user_id: 55 }),
  });

  assert.deepEqual(
    verifyTelegramContactResponse(valid.replace("55", "56"), BOT_TOKEN),
    { ok: false, error: "bad-signature" }
  );

  const stalePayload = signWebAppParams({
    auth_date: String(nowSec - 16 * 60),
    contact: JSON.stringify({ phone_number: "+79991234567", user_id: 55 }),
  });
  assert.deepEqual(verifyTelegramContactResponse(stalePayload, BOT_TOKEN), {
    ok: false,
    error: "stale",
  });
});

test("verifyTelegramContactResponse rejects missing or malformed contact JSON", () => {
  const nowSec = Math.floor(Date.now() / 1000);

  const missingContact = signWebAppParams({ auth_date: String(nowSec) });
  assert.deepEqual(verifyTelegramContactResponse(missingContact, BOT_TOKEN), {
    ok: false,
    error: "missing-contact",
  });

  const malformedJson = signWebAppParams({
    auth_date: String(nowSec),
    contact: "{not-json",
  });
  assert.deepEqual(verifyTelegramContactResponse(malformedJson, BOT_TOKEN), {
    ok: false,
    error: "malformed",
  });

  const missingUserId = signWebAppParams({
    auth_date: String(nowSec),
    contact: JSON.stringify({ phone_number: "+79991234567" }),
  });
  assert.deepEqual(verifyTelegramContactResponse(missingUserId, BOT_TOKEN), {
    ok: false,
    error: "missing-contact",
  });

  const nonStringPhone = signWebAppParams({
    auth_date: String(nowSec),
    contact: JSON.stringify({ phone_number: 79991234567, user_id: 55 }),
  });
  assert.deepEqual(verifyTelegramContactResponse(nonStringPhone, BOT_TOKEN), {
    ok: false,
    error: "missing-contact",
  });

  const missingHash = new URLSearchParams({
    auth_date: String(nowSec),
    contact: JSON.stringify({ phone_number: "+79991234567", user_id: 55 }),
  }).toString();
  assert.deepEqual(verifyTelegramContactResponse(missingHash, BOT_TOKEN), {
    ok: false,
    error: "missing-hash",
  });
});
