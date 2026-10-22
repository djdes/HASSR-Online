import assert from "node:assert/strict";
import test from "node:test";

import { miniLoginErrorKey } from "./login-error-presentation";

test("exact legacy auth messages map to semantic display keys", () => {
  const cases: Array<[string, string]> = [
    ["Введите телефон и пароль", "phoneRequired"],
    ["Введите email и пароль", "emailRequired"],
    ["Неверный телефон или пароль", "invalidPhoneCredentials"],
    ["Неверный email или пароль", "invalidEmailCredentials"],
    ["Слишком много попыток входа. Подождите 5 минут.", "rateLimited"],
    ["Слишком много попыток. Подождите 5 минут.", "rateLimited"],
    ["Внутренняя ошибка сервера", "server"],
    ["Telegram не привязан", "telegramNotLinked"],
    ["Не удалось отправить код в Telegram — попробуйте позже", "telegramDelivery"],
    ["Введите код", "codeRequired"],
    ["Неверный код", "invalidCode"],
    ["Код устарел — войдите заново", "expiredCode"],
    ["Код устарел — войдите заново, пришлём новый", "expiredCode"],
    ["Этот код уже использован — войдите заново", "usedCode"],
    ["Слишком много попыток — войдите заново, пришлём новый код", "tooManyCodeAttempts"],
    ["Аккаунт недоступен", "accountUnavailable"],
    ["Не удалось войти", "loginFailed"],
    ["Нет связи. Проверьте интернет и попробуйте ещё раз.", "connectionFailed"],
  ];
  for (const [legacy, expected] of cases) assert.equal(miniLoginErrorKey(legacy), expected, legacy);
});

test("unknown server details are never shown and code-step fallback stays safe", () => {
  assert.equal(miniLoginErrorKey("db password leaked"), "loginFailed");
  assert.equal(miniLoginErrorKey({ diagnostic: "private" }), "loginFailed");
  assert.equal(miniLoginErrorKey(undefined, true), "invalidCode");
  assert.equal(miniLoginErrorKey("unrecognized code error", true), "invalidCode");
});
