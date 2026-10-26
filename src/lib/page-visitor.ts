import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed guest cookie for the page navigation limiter: guests behind one
 * address (mobile carrier NAT, office Wi-Fi) get a budget per browser
 * instead of one shared budget. The value is a random ID and an HMAC under
 * a key derived from the auth secret: the server never stores it, and a
 * client cannot invent a valid one. Without a secret there is no cookie and
 * guests are counted by address, as before.
 */

export const VISITOR_COOKIE = "wesetup.visitor";
export const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const VERSION = "v1";
const ID = /^[A-Za-z0-9_-]{22}$/;

let cachedSecret: string | undefined;
let cachedKey: Buffer | undefined;

function keyFor(secret: string): Buffer {
  if (cachedSecret !== secret || !cachedKey) {
    cachedKey = createHmac("sha256", secret).update("wesetup-page-visitor-v1").digest();
    cachedSecret = secret;
  }
  return cachedKey;
}

function signature(secret: string, id: string): string {
  return createHmac("sha256", keyFor(secret)).update(`${VERSION}.${id}`).digest("base64url").slice(0, 22);
}

function authSecret(): string | undefined {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || undefined;
}

/** A fresh cookie value, or null when the server has no secret to sign it. */
export function issueVisitorToken(secret = authSecret()): string | null {
  if (!secret) return null;
  const id = randomBytes(16).toString("base64url");
  return `${VERSION}.${id}.${signature(secret, id)}`;
}

/** The visitor ID from a cookie value the server signed; anything else — null. */
export function verifiedVisitorId(token: string | undefined, secret = authSecret()): string | null {
  if (!secret || !token || token.length > 64) return null;
  const [version, id, sign, extra] = token.split(".");
  if (version !== VERSION || extra !== undefined || !id || !sign || !ID.test(id)) return null;
  const expected = Buffer.from(signature(secret, id));
  const actual = Buffer.from(sign);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? id : null;
}
