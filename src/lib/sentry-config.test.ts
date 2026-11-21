import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  SENTRY_DATA_COLLECTION,
  SENTRY_DSN,
  SENTRY_TUNNEL_PATH,
  scrubBreadcrumb,
  scrubEvent,
  scrubUrl,
  sentryBrowserEnabled,
  sentryRelease,
  sentryServerEnabled,
} from "./sentry-config";

/**
 * Sentry (спека cloud-testing-2026-11-21, AC5): включён только в продакшене на wesetup.ru, персональные
 * данные и токены из ссылок не уходят, туннель пересылает только события нашего DSN.
 */

describe("when Sentry is on", () => {
  it("browser: only the production build on wesetup.ru", () => {
    assert.equal(sentryBrowserEnabled({ nodeEnv: "production", hostname: "wesetup.ru" }), true);
    assert.equal(sentryBrowserEnabled({ nodeEnv: "production", hostname: "WWW.wesetup.ru" }), true);
    assert.equal(sentryBrowserEnabled({ nodeEnv: "production", hostname: "localhost" }), false);
    assert.equal(sentryBrowserEnabled({ nodeEnv: "production", hostname: "wesetup.ru.example.com" }), false);
    assert.equal(sentryBrowserEnabled({ nodeEnv: "development", hostname: "wesetup.ru" }), false);
  });

  it("server: production with the public address wesetup.ru; SENTRY_DISABLED=1 turns it off", () => {
    assert.equal(sentryServerEnabled({ NODE_ENV: "production", NEXTAUTH_URL: "https://wesetup.ru" }), true);
    assert.equal(sentryServerEnabled({ NODE_ENV: "production", NEXTAUTH_URL: "https://wesetup.ru", SENTRY_DISABLED: "1" }), false);
    assert.equal(sentryServerEnabled({ NODE_ENV: "production", NEXTAUTH_URL: "http://localhost:3005" }), false);
    assert.equal(sentryServerEnabled({ NODE_ENV: "development", NEXTAUTH_URL: "https://wesetup.ru" }), false);
    assert.equal(sentryServerEnabled({ NODE_ENV: "production" }), false);
  });

  it("release is the short build id of /api/health", () => {
    assert.equal(sentryRelease("230e9e7"), "wesetup@230e9e7");
    assert.equal(sentryRelease("dev"), undefined);
    assert.equal(sentryRelease(undefined), undefined);
  });

  it("the DSN is the EU project and the tunnel is on our domain", () => {
    assert.match(SENTRY_DSN, /^https:\/\/[0-9a-f]+@o\d+\.ingest\.de\.sentry\.io\/\d+$/);
    assert.equal(SENTRY_TUNNEL_PATH, "/api/monitoring");
  });
});

describe("what never leaves the app", () => {
  it("the SDK collects no user, cookies, bodies, query params, DB data or stack variables", () => {
    assert.ok(SENTRY_DATA_COLLECTION);
    assert.equal(SENTRY_DATA_COLLECTION.userInfo, false);
    assert.equal(SENTRY_DATA_COLLECTION.cookies, false);
    assert.deepEqual(SENTRY_DATA_COLLECTION.httpBodies, []);
    assert.equal(SENTRY_DATA_COLLECTION.urlQueryParams, false);
    assert.equal(SENTRY_DATA_COLLECTION.databaseQueryData, false);
    assert.equal(SENTRY_DATA_COLLECTION.stackFrameVariables, false);
    assert.deepEqual(SENTRY_DATA_COLLECTION.httpHeaders, { request: { allow: ["user-agent", "accept-language"] }, response: false });
  });

  it("URLs lose the query, the fragment and access tokens", () => {
    assert.equal(scrubUrl("https://wesetup.ru/invite/abc123?x=1#y"), "https://wesetup.ru/invite/:token");
    assert.equal(scrubUrl("https://wesetup.ru/login?email=a@b.c&next=/x"), "https://wesetup.ru/login");
    assert.equal(scrubUrl("/q/ABCD"), "/q/:token");
    assert.equal(scrubUrl("/api/auth/magic/short"), "/api/auth/magic/:token");
    assert.equal(scrubUrl(`/journals/x/${"A".repeat(43)}`), "/journals/x/:token");
    // record ids (cuid, 25 characters) stay: they are not secrets and help to find the record
    assert.equal(scrubUrl("/journals/hygiene/documents/cmb3x8q0f0001abcd1234efgh"), "/journals/hygiene/documents/cmb3x8q0f0001abcd1234efgh");
    assert.equal(scrubUrl(""), "");
  });

  it("events lose the user, cookies, auth headers, bodies and query strings", () => {
    const event = scrubEvent({
      user: { id: "u1", email: "cook@example.com", ip_address: "1.2.3.4" },
      request: {
        url: "https://wesetup.ru/join/SECRET?invite=1",
        query_string: "invite=1",
        cookies: { "haccp-online.session-token": "x" },
        data: { password: "p" },
        headers: { Cookie: "a=b", Authorization: "Bearer t", "X-Forwarded-For": "1.2.3.4", Referer: "https://wesetup.ru/invite/T0K?e=1", "User-Agent": "iPhone" },
      },
      breadcrumbs: [
        { category: "navigation", data: { from: "/invite/abc", to: "/dashboard?tab=1" } },
        { category: "fetch", data: { url: "/api/kiosk/claim/zzz?pin=1234", method: "POST" } },
      ],
    });
    assert.equal(event.user, undefined);
    assert.deepEqual(event.request, {
      url: "https://wesetup.ru/join/:token",
      headers: { Referer: "https://wesetup.ru/invite/:token", "User-Agent": "iPhone" },
    });
    assert.deepEqual(event.breadcrumbs?.[0].data, { from: "/invite/:token", to: "/dashboard" });
    assert.deepEqual(event.breadcrumbs?.[1].data, { url: "/api/kiosk/claim/:token", method: "POST" });
  });

  it("breadcrumbs are cleaned on their own too", () => {
    assert.deepEqual(scrubBreadcrumb({ category: "xhr", data: { url: "/policy/abc?x=1" } }).data, { url: "/policy/:token" });
    assert.deepEqual(scrubBreadcrumb({ category: "ui.click" }), { category: "ui.click" });
  });
});

describe("tunnel /api/monitoring", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const envelope = (dsn: string) =>
    `${JSON.stringify({ event_id: "0123456789abcdef0123456789abcdef", dsn, sent_at: new Date(0).toISOString() })}\n` +
    `${JSON.stringify({ type: "event" })}\n${JSON.stringify({ message: "smoke" })}\n`;

  it("forwards our DSN's envelope to the EU ingest and refuses other DSNs", async () => {
    const forwarded: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      forwarded.push(String(input));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const { POST } = await import("../app/api/monitoring/route");

    // Like a browser: the tunnel requires Content-Length (it caps the size before reading the body).
    const post = (body: string) =>
      POST(new Request("https://wesetup.ru/api/monitoring", { method: "POST", body, headers: { "content-length": String(Buffer.byteLength(body)) } }));
    const ours = await post(envelope(SENTRY_DSN));
    assert.equal(ours.status, 200);
    assert.equal(forwarded.length, 1);
    assert.match(forwarded[0], /^https:\/\/o\d+\.ingest\.de\.sentry\.io\/api\/\d+\/envelope\//);

    const foreign = await post(envelope("https://abc@o1.ingest.sentry.io/1"));
    assert.equal(foreign.status, 403);
    assert.equal(forwarded.length, 1);
  });
});
