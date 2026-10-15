import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { db } from "@/lib/db";
import { POST } from "./route";

const originalFindUnique = db.inviteToken.findUnique;

function request(password: string) {
  return new Request("https://wesetup.ru/api/invite/test-token/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

const params = { params: Promise.resolve({ token: "test-token" }) };

afterEach(() => {
  db.inviteToken.findUnique = originalFindUnique;
});

test("short password returns a stable code before looking up or mutating an invite", async () => {
  db.inviteToken.findUnique = (async () => {
    assert.fail("Invalid passwords must be rejected before token lookup");
  }) as unknown as typeof db.inviteToken.findUnique;

  const response = await POST(request("12345"), params);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, "invalid_password");
  assert.equal(body.error, "Пароль должен быть не короче 6 символов");
  assert.equal("token" in body, false);
});

test("empty invite token returns the same generic code without database access", async () => {
  db.inviteToken.findUnique = (async () => {
    assert.fail("An empty token must not reach the database");
  }) as unknown as typeof db.inviteToken.findUnique;

  const response = await POST(request("valid-password"), {
    params: Promise.resolve({ token: " " }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, "invalid_invite");
  assert.equal(body.error, "Ссылка некорректна");
  assert.equal("token" in body, false);
});

test("missing, used, and expired tokens share one generic coded response", async () => {
  const tokenHashes: string[] = [];
  let row: unknown = null;
  db.inviteToken.findUnique = (async (input: { where: { tokenHash: string } }) => {
    tokenHashes.push(input.where.tokenHash);
    return row;
  }) as unknown as typeof db.inviteToken.findUnique;

  const responses: Array<{ status: number; body: { code: string; error: string; token?: string } }> = [];
  for (const invalidRow of [
    null,
    { usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
    { usedAt: null, expiresAt: new Date(Date.now() - 60_000) },
  ]) {
    row = invalidRow;
    const response = await POST(request("valid-password"), params);
    responses.push({ status: response.status, body: await response.json() });
  }

  assert.deepEqual(responses.map((item) => item.status), [400, 400, 400]);
  assert.ok(responses.every((item) => item.body.code === "invalid_invite"));
  assert.equal(responses[0].body.error, "Ссылка недействительна");
  assert.ok(responses.every((item) => item.body.error === responses[0].body.error));
  assert.ok(responses.every((item) => item.body.token === undefined));
  assert.equal(tokenHashes.length, 3);
  assert.ok(tokenHashes.every((hash) => hash !== "test-token"));
});
