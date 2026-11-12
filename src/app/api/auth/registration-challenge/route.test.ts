import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { db } from "@/lib/db";
import { POST as instant } from "@/app/api/auth/instant-register/route";
import { POST as requestCode } from "@/app/api/auth/register/request/route";
import { POST as confirm } from "@/app/api/auth/register/confirm/route";
import { GET } from "./route";
import { issueRegistrationChallenge } from "@/lib/registration-antibot";
import { resolveRequestLocale, SITE_LOCALE_COOKIE } from "@/i18n/site-locale";

const names = ["NEXTAUTH_SECRET", "REGISTRATION_CHALLENGE_SECRET"] as const;
const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
let address = 0;
let calls: string[];
const payload = {
  email: "antibot-test@example.com", consent: true, website: "",
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
  process.env.NEXTAUTH_SECRET = "private-secret-for-route-tests";
  delete process.env.REGISTRATION_CHALLENGE_SECRET;
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
    assert.fail(`Unexpected outbound request: ${String(url)}`);
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

/** A stamp the form would have received two seconds ago. */
function stamp(ageMs = 2_000) {
  const issued = issueRegistrationChallenge({ now: Date.now() - ageMs });
  assert.ok(issued);
  return issued.token;
}

function request(body: unknown, ip = `192.0.2.${++address}`) {
  return new Request("https://wesetup.ru/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

test("guest registration locale is resolved from the public language cookie", () => {
  const registrationRequest = new Request("https://wesetup.ru/api/auth/instant-register", {
    method: "POST",
    headers: { cookie: `${SITE_LOCALE_COOKIE}=uz` },
  });
  assert.equal(resolveRequestLocale(registrationRequest), "uz");
});

for (const [name, handler] of Object.entries(endpoints)) {
  for (const [caseName, extra] of Object.entries({
    missing: () => ({}), honeypot: () => ({ captchaToken: stamp(), website: "spam" }),
    tooFast: () => ({ captchaToken: stamp(0) }),
  })) {
    test(`${name}: ${caseName} rejected before DNS/DB/notifications`, async () => {
      const response = await handler(request({ ...payload, ...extra() }));
      assert.equal(response.status, 403);
      if (name === "instant") assert.equal((await response.json()).code, "challenge_rejected");
      assert.deepEqual(calls, []);
    });
  }
  test(`${name}: forged token stops before side effects`, async () => {
    const forged = stamp().replace(/\.[^.]+$/, ".forged-signature");
    assert.equal((await handler(request({ ...payload, captchaToken: forged }))).status, 403);
    assert.deepEqual(calls, []);
  });
  test(`${name}: missing secret fails closed`, async () => {
    const captchaToken = stamp();
    delete process.env.NEXTAUTH_SECRET;
    const response = await handler(request({ ...payload, captchaToken }));
    assert.equal(response.status, 503);
    if (name === "instant") assert.equal((await response.json()).code, "challenge_unavailable");
    assert.deepEqual(calls, []);
  });
  test(`${name}: valid token reaches the existing business logic`, async () => {
    const response = await handler(request({ ...payload, captchaToken: stamp() }));
    if (name === "instant") {
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { exists: true });
      assert.deepEqual(calls, ["dns", "db.user"]);
    } else if (name === "requestCode") {
      assert.equal(response.status, 409);
      assert.deepEqual(calls, ["db.user"]);
    } else {
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /Сначала запросите код/);
      assert.deepEqual(calls, ["db.verification"]);
    }
  });
  test(`${name}: endpoint throttle runs before the bot check`, async () => {
    const ip = `198.51.100.${++address}`;
    const count = name === "confirm" ? 10 : 5;
    for (let i = 0; i < count; i++) {
      assert.equal((await handler(request({ ...payload, captchaToken: "" }, ip))).status, 403);
    }
    assert.equal((await handler(request({ ...payload, captchaToken: stamp() }, ip))).status, 429);
    assert.deepEqual(calls, []);
  });
}

test("public challenge issues a signed stamp, is never cached and never leaks the secret", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ["token"]);
  assert.match(body.token, /^v1\.\d+\.[\w-]+\.[\w-]+$/);
  assert.ok(!JSON.stringify(body).includes("private-secret"));
  delete process.env.NEXTAUTH_SECRET;
  const unavailable = GET();
  assert.equal(unavailable.status, 503);
  assert.ok(!JSON.stringify(await unavailable.json()).includes("private-secret"));
});
