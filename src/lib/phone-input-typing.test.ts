import assert from "node:assert/strict"; import test from "node:test";
import { formatRuPhoneInput } from "@/lib/phone-input";
function type(text: string) { let v = "+7 "; for (const ch of text) v = formatRuPhoneInput(v + ch, v); return v; }
test("набор поверх подставленного префикса", () => {
  assert.equal(type("+7 999 123 45 67"), "+7 999 123-45-67");
  assert.equal(type("89991234568"), "+7 999 123-45-68");
  assert.equal(type("9991234569"), "+7 999 123-45-69");
  assert.equal(type("8121234567"), "+7 812 123-45-67");
  assert.equal(formatRuPhoneInput("+7 (985) 123-45-67"), "+7 985 123-45-67");
  assert.equal(formatRuPhoneInput("8 985 123 45 67"), "+7 985 123-45-67");
});
