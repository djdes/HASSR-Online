/**
 * Offline PIN check. The device never gets the PIN or the database hash:
 * the server derives a separate verifier (PBKDF2-SHA256 with a random
 * salt) and ships it in the offline pack; the device derives the same
 * value from what the employee typed and compares.
 *
 * Isomorphic on purpose (WebCrypto exists in Node 22 and in the WebView).
 * A 4–6 digit PIN stays guessable for someone who extracts app data from
 * the device — the PIN protects against "signing for a colleague", not
 * against breaking into the tablet. The iteration count only slows that down.
 */

export const OFFLINE_PIN_ITERATIONS = 150_000;
export const OFFLINE_PIN_MAX_FAILURES = 5;
export const OFFLINE_PIN_LOCK_MS = 15 * 60 * 1000;

export type OfflinePinVerifier = {
  /** base64url */
  salt: string;
  /** base64url, 32 bytes */
  hash: string;
  iterations: number;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export function isPinShape(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export async function makeOfflinePinVerifier(pin: string, iterations: number = OFFLINE_PIN_ITERATIONS): Promise<OfflinePinVerifier> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  return { salt: toBase64Url(salt), hash: toBase64Url(await derive(pin, salt, iterations)), iterations };
}

export async function checkOfflinePin(pin: string, verifier: OfflinePinVerifier): Promise<boolean> {
  const typed = pin.trim();
  if (!isPinShape(typed)) return false;
  // Refuse absurd iteration counts from a tampered pack instead of hanging the tablet.
  if (!Number.isInteger(verifier.iterations) || verifier.iterations < 1 || verifier.iterations > 2_000_000) return false;
  let expected: Uint8Array;
  let actual: Uint8Array;
  try {
    expected = fromBase64Url(verifier.hash);
    actual = await derive(typed, fromBase64Url(verifier.salt), verifier.iterations);
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index++) diff |= expected[index] ^ actual[index];
  return diff === 0;
}

export type OfflinePinLock = { failed: number; lockedUntil: number | null };

/** Same rule as online: 5 wrong PINs in a row lock the employee for 15 minutes (on this device). */
export function nextOfflinePinLock(previous: OfflinePinLock | null | undefined, valid: boolean, now: number = Date.now()): OfflinePinLock {
  if (valid) return { failed: 0, lockedUntil: null };
  const failed = (previous?.failed ?? 0) + 1;
  return failed >= OFFLINE_PIN_MAX_FAILURES ? { failed: 0, lockedUntil: now + OFFLINE_PIN_LOCK_MS } : { failed, lockedUntil: null };
}

export function offlinePinLockMinutes(lock: OfflinePinLock | null | undefined, now: number = Date.now()): number {
  if (!lock?.lockedUntil || lock.lockedUntil <= now) return 0;
  return Math.ceil((lock.lockedUntil - now) / 60_000);
}
