import assert from "node:assert/strict";
import test from "node:test";
import { decodeHeaderValue } from "./handle-message";
import { isAllowedOrigin } from "./http";

test("isAllowedOrigin: без Origin, claude.ai и localhost — да; чужой сайт — нет; extra расширяет список", () => {
  assert.equal(isAllowedOrigin(null), true);
  assert.equal(isAllowedOrigin("https://claude.ai"), true);
  assert.equal(isAllowedOrigin("https://chatgpt.com"), true);
  assert.equal(isAllowedOrigin("http://localhost:6274"), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:3000"), true);
  assert.equal(isAllowedOrigin("https://evil.example"), false);
  assert.equal(isAllowedOrigin("http://localhost.evil.example"), false);
  assert.equal(isAllowedOrigin("https://my.app", ["https://my.app"]), true);
});

test("decodeHeaderValue: обычная строка без изменений; base64-обёртка раскрывается в UTF-8", () => {
  assert.equal(decodeHeaderValue("get_context"), "get_context");
  assert.equal(decodeHeaderValue("=?base64?0J/RgNC40LLQtdGC?="), "Привет");
});
