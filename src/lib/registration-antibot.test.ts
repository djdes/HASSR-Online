import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHALLENGE_MAX_AGE_MS,
  CHALLENGE_MIN_AGE_MS,
  issueRegistrationChallenge,
  verifyGuestOrderChallenge,
  verifyRegistrationChallenge,
} from "./registration-antibot";

const env = { NEXTAUTH_SECRET: "nextauth-secret-for-tests-only" };
const issuedAt = 1_800_000_000_000;
const later = issuedAt + CHALLENGE_MIN_AGE_MS + 1;

function token(options: { env?: Record<string, string>; now?: number } = {}) {
  const issued = issueRegistrationChallenge({ env: options.env ?? env, now: options.now ?? issuedAt });
  assert.ok(issued);
  return issued.token;
}

test("invisible challenge: a stamp older than 1.5 s with an empty honeypot passes", async () => {
  assert.deepEqual(
    await verifyRegistrationChallenge({ captchaToken: token(), website: "" }, { env, now: later }),
    { ok: true },
  );
  // Older API clients may omit the honeypot field entirely.
  assert.deepEqual(await verifyRegistrationChallenge({ captchaToken: token() }, { env, now: later }), { ok: true });
});

test("invisible challenge: the dedicated secret overrides NEXTAUTH_SECRET", async () => {
  const both = { ...env, REGISTRATION_CHALLENGE_SECRET: "dedicated-secret-value-1234" };
  const stamp = token({ env: both });
  assert.deepEqual(await verifyRegistrationChallenge({ captchaToken: stamp }, { env: both, now: later }), { ok: true });
  const other = await verifyRegistrationChallenge({ captchaToken: stamp }, { env, now: later });
  assert.equal(other.ok, false);
});

const forged = (() => {
  const parts = token().split(".");
  return {
    tamperedTime: [parts[0], String(issuedAt - 60_000), parts[2], parts[3]].join("."),
    tamperedSignature: [...parts.slice(0, 3), "A".repeat(parts[3].length)].join("."),
    wrongVersion: ["v0", ...parts.slice(1)].join("."),
    otherSecret: token({ env: { NEXTAUTH_SECRET: "a-completely-different-secret" } }),
  };
})();

for (const [name, body] of Object.entries({
  missing: {}, null: null, array: [], number: 42, empty: { captchaToken: "" },
  objectToken: { captchaToken: {} }, oversized: { captchaToken: "a".repeat(257) },
  garbage: { captchaToken: "proof" },
  honeypot: { captchaToken: token(), website: "https://spam.invalid" },
  malformedHoneypot: { captchaToken: token(), website: false },
  ...Object.fromEntries(Object.entries(forged).map(([key, value]) => [key, { captchaToken: value }])),
})) {
  test(`invisible challenge: rejects ${name}`, async () => {
    const result = await verifyRegistrationChallenge(body, { env, now: later });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });
}

test("invisible challenge: too fast, from the future and expired stamps are rejected", async () => {
  for (const now of [issuedAt, issuedAt + CHALLENGE_MIN_AGE_MS - 1, issuedAt - 1, issuedAt + CHALLENGE_MAX_AGE_MS + 1]) {
    const result = await verifyRegistrationChallenge({ captchaToken: token() }, { env, now });
    assert.equal(result.ok, false, `now=${now - issuedAt}`);
    if (!result.ok) assert.equal(result.status, 403);
  }
});

test("invisible challenge: without a signing secret it fails closed and issues nothing", async () => {
  for (const broken of [{}, { NEXTAUTH_SECRET: "short" }]) {
    assert.equal(issueRegistrationChallenge({ env: broken }), null);
    const result = await verifyRegistrationChallenge({ captchaToken: token() }, { env: broken, now: later });
    assert.deepEqual(result.ok ? null : result.status, 503);
  }
});

test("guest order challenge: passes a person, rejects bots, never blocks on a setup failure", async () => {
  assert.equal(await verifyGuestOrderChallenge({ captchaToken: token(), website: "" }, { env, now: later }), null);
  assert.equal((await verifyGuestOrderChallenge({ captchaToken: token(), website: "x" }, { env, now: later }))?.status, 403);
  assert.equal((await verifyGuestOrderChallenge({ captchaToken: token() }, { env, now: issuedAt }))?.status, 403);
  assert.equal(await verifyGuestOrderChallenge({ captchaToken: token() }, { env: {}, now: later }), null);
});
