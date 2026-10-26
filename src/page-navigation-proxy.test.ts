import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { proxy } from "./proxy";
import { isDeployWarmRequest, pageNavigationSubject } from "./lib/page-navigation-guard";
import { PAGE_NAVIGATION_LIMITS } from "./lib/page-navigation-limit";

const { automated, background, cooldownSeconds } = PAGE_NAVIGATION_LIMITS;

let address = 0;
function client(extra: Record<string, string> = {}) {
  const headers = { "x-real-ip": `192.0.2.${++address}`, "user-agent": "curl/8", ...extra };
  return (path = "/blog", more: Record<string, string> = {}, method = "GET") =>
    proxy(new NextRequest(`https://wesetup.test${path}`, { method, headers: { ...headers, ...more } }));
}
async function exhaust(request: ReturnType<typeof client>, path = "/blog") {
  for (let i = 0; i < automated.burst; i++) assert.equal((await request(path)).status, 200);
  assert.equal((await request(path)).status, 429);
}

test("real proxy denies documents and RSC before content, with a private Russian wait page", async () => {
  const request = client();
  await exhaust(request);
  const variants: Record<string, string>[] = [{}, { rsc: "1" }];
  for (const headers of variants) {
    const response = await request("/journals?secret=never-reflect-this", headers);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), String(cooldownSeconds));
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(response.headers.get("x-middleware-next"), null);
    const body = await response.text();
    assert.match(body, /Слишком много переходов/);
    assert.match(body, /id="reload-help"/);
    assert.doesNotMatch(body, /never-reflect-this|192\.0\.2/);
  }
});

test("assets, API, callbacks and operational links survive a page cooldown", async () => {
  const request = client();
  await exhaust(request);
  for (const path of ["/api/journals", "/_next/static/chunk.js", "/icons/app.png", "/favicon.ico", "/robots.txt", "/og/template", "/og-default", "/payment", "/invite/token", "/equipment-fill/token", "/room-fill/token", "/task-fill/token", "/kiosk/123"]) {
    assert.equal((await request(path)).status, 200, path);
  }
  const callback = await request("/payment/");
  assert.equal(callback.status, 200);
  assert.ok(callback.headers.get("x-middleware-rewrite"));
  assert.equal(callback.headers.get("location"), null, "payment callback remains a rewrite, not a redirect");
  for (const method of ["POST", "HEAD", "OPTIONS"]) assert.equal((await request("/journals", {}, method)).status, 200);
  assert.equal((await request("/blog/dynamic.svg")).status, 429, "a suffix cannot exempt a dynamic page");
});

test("document prefetch spoofing and forged sessions cannot reset a blocked IP", async () => {
  const request = client({ "next-router-prefetch": "1" });
  await exhaust(request);
  for (let i = 0; i < 4; i++) {
    assert.equal((await request("/blog", { "user-agent": "Mozilla/5.0", cookie: `next-auth.session-token=forged-${i}`, "x-forwarded-for": `198.51.100.${i}`, "x-user-id": `user-${i}` })).status, 429);
  }
});

test("marked and markerless RSC fetches stay bounded without blocking browser documents", async () => {
  const request = client({ "user-agent": "Mozilla/5.0 Chrome/130" });
  const headers = { rsc: "1", "next-router-prefetch": "1" };
  for (let i = 0; i < background; i++) {
    const variant: Record<string, string> = i % 3 === 0 ? headers : i % 3 === 1 ? { rsc: "1" } : { "sec-fetch-dest": "empty" };
    assert.equal((await request("/blog", variant)).status, 200);
  }
  assert.equal((await request()).status, 200);
  for (let i = 0; i < 5; i++) {
    const limited = await request("/blog", headers);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal((await request("/journals", { "sec-fetch-dest": "document" })).status, 200);
  }
});

test("ordinary employee navigation survives excess Next.js background requests", async () => {
  const saved = process.env.NEXTAUTH_SECRET;
  const secret = "employee-navigation-test-fixture-not-a-credential";
  process.env.NEXTAUTH_SECRET = secret;
  try {
    const token = await encode({ secret, token: {
      id: "prefetch-employee", role: "cook", orgKind: "regular",
      organizationId: "prefetch-organization", organizationName: "Navigation test",
      isRoot: false, actingAsOrganizationId: null, permissionPreset: null,
    } });
    const request = client({
      "user-agent": "Mozilla/5.0 Chrome/130",
      cookie: `__Secure-haccp-online.session-token=${token}`,
    });
    for (let i = 0; i < background; i++) {
      assert.equal((await request(`/journals?prefetch=${i}`, { "sec-fetch-dest": "empty" })).status, 200);
    }
    for (let i = 0; i < 5; i++) {
      assert.equal((await request("/journals", { rsc: "1" })).status, 429);
      const document = await request("/journals", { "sec-fetch-dest": "document" });
      assert.equal(document.status, 200);
      assert.equal(document.headers.get("x-middleware-next"), "1");
      assert.equal(document.headers.get("retry-after"), null);
    }
    assert.equal((await request("/root")).status, 404);
    assert.equal(new URL((await request("/settings")).headers.get("location")!).pathname, "/journals");
  } finally {
    if (saved === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = saved;
  }
});

test("subject uses verified accounts or a canonical trusted peer, never client identity hints", () => {
  assert.equal(pageNavigationSubject(new Headers({ "x-real-ip": "192.0.2.1", "x-forwarded-for": "198.51.100.1" })), "ip:192.0.2.1");
  assert.equal(pageNavigationSubject(new Headers({ "x-forwarded-for": "spoof, 192.0.2.1" })), "ip:192.0.2.1");
  for (const value of ["arbitrary", "1.2.3.4, 5.6.7.8", "fe80::1%eth0", "a".repeat(200)]) {
    assert.equal(pageNavigationSubject(new Headers({ "x-real-ip": value })), "ip:unknown");
  }
  assert.equal(pageNavigationSubject(new Headers({ "x-real-ip": "2001:0db8:0:0:0:0:0:1" })), pageNavigationSubject(new Headers({ "x-real-ip": "2001:db8::1" })));
  assert.equal(pageNavigationSubject(new Headers({ "x-user-id": "forged" })), "ip:unknown");
  assert.equal(pageNavigationSubject(new Headers(), "verified"), "user:verified");
});

test("JWT subjects isolate shared IPs; root, directory, partner and staff checks retain precedence", async () => {
  const saved = process.env.NEXTAUTH_SECRET;
  const secret = "navigation-test-fixture-secret-not-a-credential";
  process.env.NEXTAUTH_SECRET = secret;
  try {
    async function session(id: string, extra: Record<string, unknown> = {}) {
      const claims = { id, sub: id, role: "owner", orgKind: "regular", ...extra };
      const token = await encode({ secret, token: claims as Parameters<typeof encode>[0]["token"] });
      return client({ "x-real-ip": "203.0.113.1", cookie: `next-auth.session-token=${token}` });
    }
    const a = await session("limit-a");
    await exhaust(a);
    assert.equal((await a("/blog", { "x-real-ip": "203.0.113.2" })).status, 429);
    assert.equal((await (await session("limit-b"))()).status, 200);
    assert.equal((await a("/root")).status, 404);
    assert.equal((await a("/api/root/users")).status, 404);
    const directory = await session("limit-directory", { orgKind: "directory" });
    await exhaust(directory, "/master");
    assert.equal(new URL((await directory("/dashboard")).headers.get("location")!).pathname, "/master");
    const staff = await session("limit-staff", { role: "cook" });
    await exhaust(staff);
    assert.equal(new URL((await staff("/settings")).headers.get("location")!).pathname, "/journals");
    const partner = await session("limit-partner", { activeOrganizationId: "client", partnerAccess: { partnerId: "partner", organizationId: "client", level: "view" } });
    await exhaust(partner);
    assert.equal((await partner("/api/payments")).status, 403);
    assert.equal(new URL((await partner("/settings/consultant")).headers.get("location")!).pathname, "/partner/denied");
    const root = await session("limit-root", { isRoot: true });
    await exhaust(root, "/root");
  } finally {
    if (saved === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = saved;
  }
});

test("marked and markerless RSC fetches share a bounded budget; its overflow never blocks real pages", async () => {
  const request = client();
  const headers = { rsc: "1", "next-router-prefetch": "1" };
  for (let i = 0; i < background; i++) {
    const variant: Record<string, string> = i % 3 === 0 ? headers : i % 3 === 1 ? { rsc: "1" } : { "sec-fetch-dest": "empty" };
    assert.equal((await request("/blog", variant)).status, 200);
  }
  assert.equal((await request()).status, 200);
  assert.equal((await request("/blog", headers)).status, 429);
  assert.equal((await request("/blog", { "sec-fetch-dest": "empty" })).status, 429);
  // Background fetches over budget wait on their own; the page itself still opens.
  assert.equal((await request()).status, 200);
});

test("deploy prewarm key: only an exact match of a long key from the process env", () => {
  const key = "k".repeat(32);
  const headers = (value?: string) => new Headers(value === undefined ? {} : { "x-deploy-warm": value });
  assert.equal(isDeployWarmRequest(headers(key), key), true);
  assert.equal(isDeployWarmRequest(headers(key), undefined), false, "no key in the env exempts nothing");
  assert.equal(isDeployWarmRequest(headers(""), ""), false);
  assert.equal(isDeployWarmRequest(headers("s".repeat(31)), "s".repeat(31)), false, "a short key is never accepted");
  assert.equal(isDeployWarmRequest(headers(), key), false);
  for (const wrong of [key.toUpperCase(), key.slice(1), `${key}k`]) assert.equal(isDeployWarmRequest(headers(wrong), key), false, wrong);
});

test("deploy prewarm with the per-deploy key skips the page budget; other requests stay limited", async () => {
  const saved = process.env.DEPLOY_WARM_TOKEN;
  const key = "0123456789abcdef".repeat(4);
  process.env.DEPLOY_WARM_TOKEN = key;
  try {
    const request = client();
    for (let i = 0; i < automated.burst * 2; i++) assert.equal((await request(`/journals?warm=${i}`, { "x-deploy-warm": key })).status, 200);
    // The prewarm spent none of the address's budget: curl still gets its full burst.
    await exhaust(request);
    for (const wrong of ["", key.slice(1), `${key}0`, "f".repeat(64)]) {
      assert.equal((await request("/blog", { "x-deploy-warm": wrong })).status, 429, wrong);
    }
    assert.equal((await request("/blog", { "x-deploy-warm": key })).status, 200);
    assert.equal((await request("/root", { "x-deploy-warm": key })).status, 404, "the key bypasses only the page budget");
  } finally {
    if (saved === undefined) delete process.env.DEPLOY_WARM_TOKEN;
    else process.env.DEPLOY_WARM_TOKEN = saved;
  }
});
