import assert from "node:assert/strict";
import { test } from "node:test";

import { checkOfflinePin, makeOfflinePinVerifier, nextOfflinePinLock, offlinePinLockMinutes } from "./pin-verifier";

test("right PIN passes, wrong PIN and malformed input fail", async () => {
  const verifier = await makeOfflinePinVerifier("4821", 1000);
  assert.equal(await checkOfflinePin("4821", verifier), true);
  assert.equal(await checkOfflinePin(" 4821 ", verifier), true);
  assert.equal(await checkOfflinePin("4822", verifier), false);
  assert.equal(await checkOfflinePin("48", verifier), false);
  assert.equal(await checkOfflinePin("abcd", verifier), false);
});

test("the verifier does not contain the PIN and differs per issue", async () => {
  const first = await makeOfflinePinVerifier("4821", 1000);
  const second = await makeOfflinePinVerifier("4821", 1000);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(JSON.stringify(first).includes("4821"), false);
});

test("a tampered verifier never passes", async () => {
  const verifier = await makeOfflinePinVerifier("4821", 1000);
  assert.equal(await checkOfflinePin("4821", { ...verifier, iterations: 0 }), false);
  assert.equal(await checkOfflinePin("4821", { ...verifier, hash: "!!" }), false);
});

test("five wrong PINs lock for 15 minutes, a right one resets", () => {
  const now = 1_000_000;
  let lock = nextOfflinePinLock(null, false, now);
  for (let index = 0; index < 3; index++) lock = nextOfflinePinLock(lock, false, now);
  assert.deepEqual(lock, { failed: 4, lockedUntil: null });
  lock = nextOfflinePinLock(lock, false, now);
  assert.equal(offlinePinLockMinutes(lock, now), 15);
  assert.equal(offlinePinLockMinutes(lock, now + 16 * 60_000), 0);
  assert.deepEqual(nextOfflinePinLock({ failed: 3, lockedUntil: null }, true, now), { failed: 0, lockedUntil: null });
});
