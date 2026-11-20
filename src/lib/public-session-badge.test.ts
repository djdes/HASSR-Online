import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { encode } from "next-auth/jwt";

import { sessionCookieName } from "@/lib/auth-cookies";
import { decodePublicSessionBadgeFromCookie } from "./public-session-badge";

const SECRET = "test-secret-for-public-session-badge-32bytes!";
const SESSION_COOKIE_NAME = sessionCookieName();

async function mintJwt(claims: Record<string, unknown>): Promise<string> {
  return encode({ secret: SECRET, token: claims as unknown as Parameters<typeof encode>[0]["token"] });
}

describe("public-session-badge (0 DB SELECT JWT reader)", () => {
  it("returns null when no session cookie or secret is present", async () => {
    const res = await decodePublicSessionBadgeFromCookie(() => undefined, SECRET);
    assert.equal(res, null);

    const noSecret = await decodePublicSessionBadgeFromCookie(() => "tok", "");
    assert.equal(noSecret, null);
  });

  it("decodes valid signed JWT claims without touching the database", async () => {
    const raw = await mintJwt({
      id: "user_1",
      name: "Иван Петров",
      role: "manager",
      isRoot: false,
    });

    const badge = await decodePublicSessionBadgeFromCookie(
      (name) => (name === SESSION_COOKIE_NAME ? raw : undefined),
      SECRET,
    );

    assert.deepEqual(badge, {
      id: "user_1",
      name: "Иван Петров",
      role: "manager",
      isRoot: false,
    });
  });

  it("elevates role to owner when canManageSettings claim is true", async () => {
    const raw = await mintJwt({
      id: "user_2",
      name: "Анна",
      role: "cook",
      canManageSettings: true,
      isRoot: false,
    });

    const badge = await decodePublicSessionBadgeFromCookie(
      (name) => (name === SESSION_COOKIE_NAME ? raw : undefined),
      SECRET,
    );

    assert.equal(badge?.role, "owner");
  });

  it("rejects locked kiosk tokens and forged tokens", async () => {
    const lockedKiosk = await mintJwt({
      id: "user_3",
      name: "Повар",
      role: "cook",
      kiosk: true,
      lockAt: Date.now() - 5_000,
    });

    const res1 = await decodePublicSessionBadgeFromCookie(
      (name) => (name === SESSION_COOKIE_NAME ? lockedKiosk : undefined),
      SECRET,
    );
    assert.equal(res1, null);

    const res2 = await decodePublicSessionBadgeFromCookie(
      (name) => (name === SESSION_COOKIE_NAME ? "forged.jwt.value" : undefined),
      SECRET,
    );
    assert.equal(res2, null);
  });

  it("never imports @/lib/db or @/lib/auth", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/public-session-badge.ts"),
      "utf8",
    );
    assert.doesNotMatch(source, /@\/lib\/db|from\s+["']\.\/db["']/);
    assert.doesNotMatch(source, /@\/lib\/auth["']|from\s+["']\.\/auth["']/);
  });
});
