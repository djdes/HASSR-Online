import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { db } from "@/lib/db";
import { POST as instant } from "@/app/api/auth/instant-register/route";
import { POST as requestCode } from "@/app/api/auth/register/request/route";
import { POST as confirm } from "@/app/api/auth/register/confirm/route";
import { GET } from "./route";

const names = ["RECAPTCHA_SITE_KEY", "RECAPTCHA_SECRET_KEY", "RECAPTCHA_HOSTNAMES"] as const;
const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
let address = 0;
let calls: string[];
const payload = {
  email: "antibot-test@example.com", consent: true, captchaToken: "proof", website: "",
  code: "123456", password: "password123", name: "Test", phone: "+79991234567", organizationName: "Test",
};
const endpoints = { instant, requestCode, confirm };
const original = {
  findUser: db.user.findUnique,
  findVerification: db.emailVerification.findUnique,
  transaction: db.$transaction,
  upsertVerification: db.emailVerification.upsert,
};

beforeEach(() => {
  process.env.RECAPTCHA_SITE_KEY = "site-key";
  process.env.RECAPTCHA_SECRET_KEY = "private-secret";
  process.env.RECAPTCHA_HOSTNAMES = "wesetup.ru";
  calls = [];
  // Terminal read-only branches: even a gate regression cannot create an account.
  // Prisma delegates are proxies, so node:test's descriptor-based mock.method
  // cannot replace them. Assign overrides and explicitly restore after each test.
  db.user.findUnique = (async () => {
    calls.push("db.user"); return { id: "existing" };
  }) as unknown as typeof db.user.findUnique;
  db.emailVerification.findUnique = (async () => {
    calls.push("db.verification"); return null;
  }) as unknown as typeof db.emailVerification.findUnique;
  db.$transaction = (() => { assert.fail("No real writes in registration tests"); }) as typeof db.$transaction;
  db.emailVerification.upsert = (() => {
    assert.fail("No verification writes in tests");
  }) as typeof db.emailVerification.upsert;
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).startsWith("https://dns.google/")) {
      calls.push("dns");
      return Response.json({ Status: 0, Answer: [{ data: "10 mx.example.com" }] });
    }
    assert.equal(String(url), "https://www.recaptcha.net/recaptcha/api/siteverify");
    calls.push("siteverify");
    return Response.json({ success: true, hostname: "wesetup.ru" });
  });
});

afterEach(() => {
  mock.restoreAll();
  db.user.findUnique = original.findUser;
  db.emailVerification.findUnique = original.findVerification;
  db.$transaction = original.transaction;
  db.emailVerification.upsert = original.upsertVerification;
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

function request(body: unknown, ip = `192.0.2.${++address}`) {
  return new Request("https://wesetup.ru/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

for (const [name, handler] of Object.entries(endpoints)) {
  for (const [caseName, extra] of Object.entries({
    missing: { captchaToken: undefined }, honeypot: { website: "spam" },
  })) {
    test(`${name}: ${caseName} rejected before DNS/DB/provider/notifications`, async () => {
      const response = await handler(request({ ...payload, ...extra }));
      assert.equal(response.status, 403);
      assert.deepEqual(calls, []);
    });
  }
  test(`${name}: forged/replayed provider token stops before side effects`, async () => {
    mock.method(globalThis, "fetch", async () => Response.json({
      success: false, "error-codes": ["timeout-or-duplicate"],
    }));
    assert.equal((await handler(request(payload))).status, 403);
    assert.deepEqual(calls, []);
  });
  test(`${name}: missing secret fails closed`, async () => {
    delete process.env.RECAPTCHA_SECRET_KEY;
    assert.equal((await handler(request(payload))).status, 503);
    assert.deepEqual(calls, []);
  });
  test(`${name}: valid token reaches the existing business logic`, async () => {
    const response = await handler(request(payload));
    assert.equal(calls[0], "siteverify");
    if (name === "instant") {
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { exists: true });
      assert.deepEqual(calls, ["siteverify", "dns", "db.user"]);
    } else if (name === "requestCode") {
      assert.equal(response.status, 409);
      assert.deepEqual(calls, ["siteverify", "db.user"]);
    } else {
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /Сначала запросите код/);
      assert.deepEqual(calls, ["siteverify", "db.verification"]);
    }
  });
  test(`${name}: endpoint throttle runs before reCAPTCHA`, async () => {
    const ip = `198.51.100.${++address}`;
    const count = name === "confirm" ? 10 : 5;
    for (let i = 0; i < count; i++) {
      assert.equal((await handler(request({ ...payload, captchaToken: "" }, ip))).status, 403);
    }
    assert.equal((await handler(request(payload, ip))).status, 429);
    assert.deepEqual(calls, []);
  });
}

test("public challenge config only exposes the site key and is never cached", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { siteKey: "site-key" });
  delete process.env.RECAPTCHA_SECRET_KEY;
  const unavailable = GET();
  assert.equal(unavailable.status, 503);
  assert.ok(!JSON.stringify(await unavailable.json()).includes("private-secret"));
});
