import assert from "node:assert/strict";
import { test } from "node:test";
import { localizedHref, parseSiteLocale, publicLocaleRoute, publicLocalesForPath, siteLanguageAlternates, resolveRequestLocale } from "./site-locale";

test("API email locale comes from the request cookie or explicit authenticated preference without server render state", () => {
  const request = (path: string, cookie = "wesetup.site-locale=uz") => new Request(`https://wesetup.ru${path}`, { headers: { cookie } });
  assert.equal(resolveRequestLocale(request("/api/auth/instant-register")), "uz");
  assert.equal(resolveRequestLocale(request("/api/profile"), { authenticated: true, userLocale: "en", organizationLocale: "ru" }), "en");
  assert.equal(resolveRequestLocale(request("/en/login")), "en");
  assert.equal(resolveRequestLocale(request("/api/auth/instant-register", "wesetup.site-locale=invalid")), "ru");
  assert.equal(resolveRequestLocale(request("/api/auth/instant-register", "other.wesetup.site-locale=en; wesetup.site-locale=uz")), "uz");
});

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

test("blog aliases preserve slugs and filters while explicit URLs override saved preferences", () => {
  for (const path of ["/blog", "/blog/zhurnal-dezinfektsii", "/blog/feed.xml"]) {
    assert.equal(localizedHref(`${path}?tag=test#heading`, "uz"), `/uz${path}?tag=test#heading`);
    assert.equal(localizedHref(`/uz${path}`, "ru"), path);
    assert.deepEqual(publicLocalesForPath(path), ["ru", "en", "uz"]);
    const request = new Request(`https://wesetup.ru${path}`, { headers: { cookie: "wesetup.site-locale=en" } });
    assert.equal(resolveRequestLocale(request), "ru");
  }
  assert.equal(publicLocaleRoute("/uz/blog/article/private"), null);
});

test("language URLs cannot target private routes, callbacks or other origins", () => {
  for (const href of ["/api/auth", "/root", "/en/root", "/dashboard", "/payment/", "/invite/token", "https://other.test/", "//other.test/", "/\\other.test/", "mailto:support@wesetup.ru", "#pricing"]) {
    assert.equal(localizedHref(href, "en"), href);
  }
  assert.equal(publicLocaleRoute("/en/root"), null);
  assert.equal(publicLocaleRoute("/en/api/auth"), null);
});

test("language alternates use canonical HTTPS URLs", () => {
  assert.deepEqual(siteLanguageAlternates("/"), { ru: "https://wesetup.ru/", en: "https://wesetup.ru/en", uz: "https://wesetup.ru/uz", "x-default": "https://wesetup.ru/" });
});

test("Uzbek auth aliases round-trip and only advertise existing translated routes", () => {
  assert.deepEqual(publicLocaleRoute("/uz/login"), { locale: "uz", pathname: "/login" });
  assert.equal(localizedHref("/en/register?next=%2Fdashboard#email", "uz"), "/uz/register?next=%2Fdashboard#email");
  assert.equal(localizedHref("/uz/register?next=%2Fdashboard", "ru"), "/register?next=%2Fdashboard");
  assert.deepEqual(publicLocalesForPath("/login"), ["ru", "en", "uz"]);
  assert.deepEqual(publicLocalesForPath("/"), ["ru", "en", "uz"]);
  assert.equal(publicLocaleRoute("/uz/api/auth"), null);
  assert.equal(publicLocaleRoute("/uz/root"), null);
  assert.equal(localizedHref("/api/reports/pdf", "uz"), "/api/reports/pdf");
  assert.equal(siteLanguageAlternates("/register").uz, "https://wesetup.ru/uz/register");
});
