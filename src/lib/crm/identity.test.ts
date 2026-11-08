import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isOurDomain, matchSenderRule, normalizeEmail, normalizeRulePattern, phoneKey, whatsappHref } from "@/lib/crm/identity";

describe("CRM: ключи склейки контактов", () => {
  it("почта: нижний регистр, mailto, мусор — null", () => {
    assert.equal(normalizeEmail("  Ivan@Cafe.RU "), "ivan@cafe.ru");
    assert.equal(normalizeEmail("mailto:a@b.ru"), "a@b.ru");
    assert.equal(normalizeEmail("не почта"), null);
    assert.equal(normalizeEmail("a@b"), null);
    assert.equal(normalizeEmail(null), null);
  });

  it("телефон: последние 10 цифр в любом формате", () => {
    assert.equal(phoneKey("+7 (912) 345-67-89"), "9123456789");
    assert.equal(phoneKey("8 912 345 67 89"), "9123456789");
    assert.equal(phoneKey("9123456789"), "9123456789");
    assert.equal(phoneKey("12-34"), null);
    assert.equal(phoneKey(undefined), null);
  });

  it("ссылка WhatsApp: российский номер с кодом 7", () => {
    assert.equal(whatsappHref("8 912 345-67-89"), "https://wa.me/79123456789");
    assert.equal(whatsappHref("+7 912 345-67-89"), "https://wa.me/79123456789");
    assert.equal(whatsappHref("912 345 67 89"), "https://wa.me/79123456789");
    assert.equal(whatsappHref("+998 90 123 45 67"), "https://wa.me/998901234567");
    assert.equal(whatsappHref("123"), null);
  });

  it("правила: ввод человека → адрес или @домен", () => {
    assert.equal(normalizeRulePattern("Ivan@Cafe.ru"), "ivan@cafe.ru");
    assert.equal(normalizeRulePattern("cafe.ru"), "@cafe.ru");
    assert.equal(normalizeRulePattern("@Cafe.ru"), "@cafe.ru");
    assert.equal(normalizeRulePattern("кафе.рф"), "@кафе.рф");
    assert.equal(normalizeRulePattern("просто текст"), null);
    assert.equal(normalizeRulePattern(""), null);
  });

  it("правила: адрес важнее домена, домен покрывает поддомены, allow бьёт block", () => {
    const rules = [
      { pattern: "@shop.ru", action: "block" },
      { pattern: "boss@shop.ru", action: "allow" },
    ];
    assert.equal(matchSenderRule("boss@shop.ru", rules), "allow");
    assert.equal(matchSenderRule("sale@shop.ru", rules), "block");
    assert.equal(matchSenderRule("sale@mail.shop.ru", rules), "block");
    assert.equal(matchSenderRule("sale@notshop.ru", rules), null);
    assert.equal(matchSenderRule("x@y.ru", [{ pattern: "@y.ru", action: "block" }, { pattern: "@y.ru", action: "allow" }]), "allow");
    assert.equal(matchSenderRule(null, rules), null);
  });

  it("наш домен", () => {
    assert.equal(isOurDomain("admin@wesetup.ru", ["wesetup.ru"]), true);
    assert.equal(isOurDomain("a@notwesetup.ru", ["wesetup.ru"]), false);
  });
});
