import assert from "node:assert/strict";
import test from "node:test";

// Секрет нужен до импорта: `telegram.ts` читает его при подписи токена.
process.env.TELEGRAM_LINK_TOKEN_SECRET ??= "test-secret-for-link-tokens";

import {
  generateBotInviteRaw,
  stripBotInvitePrefix,
} from "@/lib/bot-invite-tokens";
import { generateLinkToken, parseLinkToken } from "@/lib/telegram";

/**
 * У `/start` два вида payload: приглашение сотрудника (`inv_…`) и токен
 * привязки собственного аккаунта из настроек. Обработчик различает их по
 * префиксу, поэтому важно, чтобы один не опознавался как другой: иначе
 * человек снова получит «Ссылка-приглашение некорректна».
 */

test("invite payload is recognised as an invite and not as a link token", () => {
  const invite = generateBotInviteRaw();

  assert.ok(stripBotInvitePrefix(invite), "приглашение должно опознаваться");
  assert.equal(
    parseLinkToken(invite),
    null,
    "приглашение не должно проходить как токен привязки"
  );
});

test("self-link token is recognised as a link token and not as an invite", () => {
  const token = generateLinkToken("user_1");

  assert.equal(
    stripBotInvitePrefix(token),
    null,
    "токен привязки не должен опознаваться как приглашение"
  );
  assert.deepEqual(parseLinkToken(token), { userId: "user_1" });
});

test("self-link token fits Telegram's 64-char start parameter", () => {
  // cuid реального пользователя — 25 символов.
  const token = generateLinkToken("cmtwy9jfx00ux3vtsbfnaofr3");

  assert.ok(token.length <= 64, `длина ${token.length}`);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(parseLinkToken(token), { userId: "cmtwy9jfx00ux3vtsbfnaofr3" });
});

test("expired self-link token is rejected", () => {
  assert.equal(parseLinkToken(generateLinkToken("user_1", -1000)), null);
});

test("garbage payload matches neither", () => {
  assert.equal(stripBotInvitePrefix("привет"), null);
  assert.equal(parseLinkToken("привет"), null);
});

test("tampered link token is rejected", () => {
  // Подпись HMAC — иначе чужой id в ссылке привязал бы чужой аккаунт.
  const token = generateLinkToken("user_1");
  assert.equal(parseLinkToken(token.replace("user_1", "user_2")), null);
  // Продлить срок, не зная секрета, тоже нельзя.
  assert.equal(parseLinkToken(token.replace(/_([0-9a-z]+)_(.{22})$/, "_zzzzzz_$2")), null);
});
