import assert from "node:assert/strict";
import { test } from "node:test";
import { localizedHref, parseSiteLocale, publicLocaleRoute, siteLanguageAlternates } from "./site-locale";

test("only explicit supported locale values are accepted", () => {
  assert.equal(parseSiteLocale("en"), "en");
  for (const value of [null, undefined, "EN", "fr", "en,ru", "<script>"]) assert.equal(parseSiteLocale(value), "ru");
});

test("translated public URLs round-trip without losing queries or hashes", () => {
  assert.equal(localizedHref("/?source=qr#pricing", "en"), "/en?source=qr#pricing");
  assert.equal(localizedHref("/en?source=qr#pricing", "ru"), "/?source=qr#pricing");
  assert.equal(localizedHref("/en", "en"), "/en");
  assert.deepEqual(publicLocaleRoute("/en"), { locale: "en", pathname: "/" });
});

test("language URLs cannot target private routes, callbacks or other origins", () => {
  for (const href of ["/api/auth", "/root", "/en/root", "/dashboard", "/payment/", "/invite/token", "https://other.test/", "//other.test/", "/\\other.test/", "mailto:support@wesetup.ru", "#pricing"]) {
    assert.equal(localizedHref(href, "en"), href);
  }
  assert.equal(publicLocaleRoute("/en/root"), null);
  assert.equal(publicLocaleRoute("/en/api/auth"), null);
});

test("language alternates use canonical HTTPS URLs", () => {
  assert.deepEqual(siteLanguageAlternates("/"), { ru: "https://wesetup.ru/", en: "https://wesetup.ru/en", "x-default": "https://wesetup.ru/" });
});
