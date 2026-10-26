import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
import { PAGE_NAVIGATION_LIMITS } from "./lib/page-navigation-limit";

let address = 0;
const request = (path: string, headers: Record<string, string> = {}) => proxy(new NextRequest(`https://wesetup.test${path}`, {
  headers: { "x-real-ip": `198.51.100.${++address}`, "user-agent": "Mozilla/5.0", ...headers },
}));

test("English document keeps its explicit route and receives a trusted locale", async () => {
  const response = await request("/en?utm_source=proof");
  assert.equal(response.headers.get("x-middleware-rewrite"), null);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("x-middleware-request-x-wesetup-site-locale"), "en");
  assert.match(response.headers.get("set-cookie") ?? "", /wesetup.site-locale=en/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("caller-supplied locale headers cannot change the locale of the requested URL", async () => {
  for (const path of ["/", "/login", "/api/auth/session"]) {
    const response = await request(path, { "x-wesetup-site-locale": "en" });
    assert.equal(response.headers.get("x-middleware-request-x-wesetup-site-locale"), "ru", path);
  }
});

test("English prefix never rewrites protected routes or callbacks", async () => {
  for (const path of ["/en/root", "/en/dashboard", "/en/api/root/users", "/en/payment"]) {
    const response = await request(path);
    assert.equal(response.headers.get("x-middleware-rewrite"), null, path);
  }
  assert.equal((await request("/root")).status, 404);
});

test("prefetching another language does not overwrite the visitor preference", async () => {
  const response = await request("/en", { "sec-fetch-dest": "empty" });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-middleware-request-x-wesetup-site-locale"), "en");
});

test("English pages retain the navigation budget and show an English cooldown", async () => {
  const headers = { "x-real-ip": "203.0.113.219", "user-agent": "curl/8" };
  for (let i = 0; i < PAGE_NAVIGATION_LIMITS.automated.burst; i++) assert.equal((await request("/en", headers)).status, 200);
  const response = await request("/en", headers);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), String(PAGE_NAVIGATION_LIMITS.cooldownSeconds));
  const html = await response.text();
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Too many page requests/);
  assert.doesNotMatch(html, /[А-Яа-яЁё]/);
});

test("partners and privacy trust their six explicit URLs without rewriting navigation", async () => {
  for (const page of ["/partners", "/privacy"]) {
    for (const locale of ["ru", "en", "uz"] as const) {
      const path = `${locale === "ru" ? "" : `/${locale}`}${page}`;
      const response = await request(`${path}?next=%2Fsettings%2Fpartner`, {
        "x-wesetup-site-locale": locale === "ru" ? "en" : "ru",
        cookie: "wesetup.site-locale=en",
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
      assert.equal(response.headers.get("x-middleware-rewrite"), null);
      assert.equal(response.headers.get("location"), null);
      assert.equal(response.headers.get("x-middleware-request-x-wesetup-site-locale"), locale);
      assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`wesetup.site-locale=${locale}`));
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      const prefetched = await request(path, { "sec-fetch-dest": "empty" });
      assert.equal(prefetched.headers.get("set-cookie"), null);
      assert.equal(prefetched.headers.get("x-middleware-request-x-wesetup-site-locale"), locale);
    }
  }
});
