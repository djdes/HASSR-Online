import assert from "node:assert/strict";
import test from "node:test";

import { looksLikePhoneInput, phoneQueryValue } from "@/lib/login-identifier";

test("телефон в поле «Email» распознаётся", () => {
  assert.equal(looksLikePhoneInput("+7 999 123-45-67"), true);
  assert.equal(looksLikePhoneInput("89991234567"), true);
  assert.equal(looksLikePhoneInput("9991234567"), true);
});

test("почта и обрывки за телефон не принимаются", () => {
  assert.equal(looksLikePhoneInput("ivanova@restoran.ru"), false);
  assert.equal(looksLikePhoneInput("+7 999"), false);
  assert.equal(looksLikePhoneInput("ivanova"), false);
  assert.equal(looksLikePhoneInput(""), false);
});

test("номер приводится к виду для ссылки на вход по телефону", () => {
  assert.equal(phoneQueryValue("8 999 123-45-67"), "+79991234567");
  assert.equal(phoneQueryValue("+7 999 123-45-67"), "+79991234567");
  assert.equal(phoneQueryValue("9991234567"), "+79991234567");
});
