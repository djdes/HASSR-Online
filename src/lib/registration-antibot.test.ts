import assert from "node:assert/strict";
import { test } from "node:test";
import { registrationChallengeConfig, verifyRegistrationChallenge } from "./registration-antibot";

const env = {
  NODE_ENV: "production",
  RECAPTCHA_SITE_KEY: "site-key",
  RECAPTCHA_SECRET_KEY: "private-secret",
  RECAPTCHA_HOSTNAMES: "wesetup.ru,www.wesetup.ru",
};
const valid = { success: true, hostname: "wesetup.ru" };
const input = { captchaToken: "proof", website: "" };
const reply = (data: unknown, status = 200): typeof fetch => async () => Response.json(data, { status });

test("registration challenge: accepts verified status and exact configured host", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://www.recaptcha.net/recaptcha/api/siteverify");
    assert.equal(options?.method, "POST");
    assert.equal(options?.cache, "no-store");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal instanceof AbortSignal);
    assert.equal(new Headers(options?.headers).get("content-type"), "application/x-www-form-urlencoded");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(String(options?.body))), { secret: "private-secret", response: "proof" });
    return Response.json(valid);
  };
  assert.deepEqual(await verifyRegistrationChallenge(input, { env, fetch: fetcher }), { ok: true });
  assert.equal(calls, 1);
  assert.deepEqual(registrationChallengeConfig(env), { siteKey: "site-key" });
});

for (const [name, body] of Object.entries({
  missing: {}, null: null, array: [], number: 42, empty: { captchaToken: "" },
  whitespace: { captchaToken: "  " }, objectToken: { captchaToken: {} },
  oversized: { captchaToken: "a".repeat(8193) },
  honeypot: { ...input, website: "https://spam.invalid" },
  malformedHoneypot: { ...input, website: false },
})) {
  test(`registration challenge: rejects ${name} without provider access`, async () => {
    const result = await verifyRegistrationChallenge(body, {
      env, fetch: async () => { assert.fail("must not call reCAPTCHA"); },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });
}

for (const [name, data] of Object.entries({
  forged: { success: false, "error-codes": ["timeout-or-duplicate"] },
  replayedOrExpired: { success: false, "error-codes": ["timeout-or-duplicate"] },
  bot: { success: false },
  wrongHost: { ...valid, hostname: "evil.example" },
  suffixAttack: { ...valid, hostname: "wesetup.ru.evil.example" },
  wrongPort: { ...valid, hostname: "wesetup.ru:8080" },
})) {
  test(`registration challenge: rejects provider result ${name}`, async () => {
    const result = await verifyRegistrationChallenge(input, { env, fetch: reply(data) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
    assert.ok(!JSON.stringify(result).includes(env.RECAPTCHA_SECRET_KEY));
  });
}

for (const [name, fetcher] of Object.entries({
  httpFailure: reply({}, 502),
  quotaFallback: reply({ ...valid, score: 0.9, "error-codes": ["Over free quota."] }),
  v3Key: reply({ ...valid, score: 0.1, action: "register" }),
  successWithErrors: reply({ ...valid, "error-codes": ["unexpected-error"] }),
  malformedErrors: reply({ ...valid, "error-codes": "unexpected-error" }),
  invalidSecret: reply({ success: false, "error-codes": ["invalid-input-secret"] }),
  missingProviderSecret: reply({ success: false, "error-codes": ["missing-input-secret"] }),
  badProviderRequest: reply({ success: false, "error-codes": ["bad-request"] }),
  malformedResponse: reply(null),
  arrayResponse: reply([]),
  emptyHost: reply({ ...valid, hostname: "" }),
  missingHost: reply({ success: true }),
  unknownStatus: reply({ success: "true", hostname: "wesetup.ru" }),
  badJson: (async () => new Response("not json")) as typeof fetch,
  network: (async () => { throw new Error("network unavailable"); }) as typeof fetch,
  timeout: (async () => { throw new DOMException("Timed out", "TimeoutError"); }) as typeof fetch,
})) {
  test(`registration challenge: fails closed on ${name}`, async () => {
    const result = await verifyRegistrationChallenge(input, { env, fetch: fetcher });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 503);
  });
}

for (const [name, config] of Object.entries({
  noKeys: {},
  missingSecret: { ...env, RECAPTCHA_SECRET_KEY: "" },
  missingSite: { ...env, RECAPTCHA_SITE_KEY: "" },
  missingHostname: { ...env, RECAPTCHA_HOSTNAMES: "" },
  invalidUrl: { ...env, RECAPTCHA_HOSTNAMES: "", NEXTAUTH_URL: "not a URL" },
  wildcard: { ...env, RECAPTCHA_HOSTNAMES: "*.wesetup.ru" },
  publicTestSite: { ...env, RECAPTCHA_SITE_KEY: "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI" },
  publicTestSecret: { ...env, RECAPTCHA_SECRET_KEY: "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe" },
  portInAllowlist: { ...env, RECAPTCHA_HOSTNAMES: "wesetup.ru:443" },
})) {
  test(`registration challenge: configuration ${name} cannot silently bypass protection`, async () => {
    assert.equal(registrationChallengeConfig(config), null);
    const result = await verifyRegistrationChallenge(input, {
      env: config, fetch: async () => { assert.fail("must not contact provider with invalid config"); },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 503);
  });
}

test("registration challenge: NEXTAUTH_URL is a trusted hostname fallback and excludes ports", async () => {
  const fallback = { ...env, RECAPTCHA_HOSTNAMES: "", NEXTAUTH_URL: "https://wesetup.ru/path" };
  assert.deepEqual(await verifyRegistrationChallenge(input, { env: fallback, fetch: reply(valid) }), { ok: true });
  assert.deepEqual(await verifyRegistrationChallenge(input, {
    env, fetch: reply({ ...valid, hostname: "www.wesetup.ru" }),
  }), { ok: true });
  const local = { ...env, RECAPTCHA_HOSTNAMES: "", NEXTAUTH_URL: "http://localhost:3000" };
  assert.deepEqual(await verifyRegistrationChallenge(input, {
    env: local, fetch: reply({ ...valid, hostname: "localhost" }),
  }), { ok: true });
  const result = await verifyRegistrationChallenge(input, {
    env: local, fetch: reply({ ...valid, hostname: "evil.example" }),
  });
  assert.equal(result.ok, false);
});
