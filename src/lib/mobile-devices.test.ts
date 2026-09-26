import test from "node:test";
import assert from "node:assert/strict";

import { validateDeviceInput } from "./mobile-devices";

test("принимает ключ устройства и платформу", () => {
  const token = "a".repeat(40);
  assert.deepEqual(validateDeviceInput({ token, platform: "android" }), {
    ok: true,
    token,
    platform: "android",
  });
  assert.deepEqual(validateDeviceInput({ token: `  ${token}  `, platform: "ios" }), {
    ok: true,
    token,
    platform: "ios",
  });
});

test("отвергает пустой, короткий, длинный ключ и чужую платформу", () => {
  assert.equal(validateDeviceInput({ token: "", platform: "ios" }).ok, false);
  assert.equal(validateDeviceInput({ token: "short", platform: "ios" }).ok, false);
  assert.equal(validateDeviceInput({ token: "x".repeat(5000), platform: "ios" }).ok, false);
  assert.equal(validateDeviceInput({ token: "x".repeat(40), platform: "windows" }).ok, false);
  assert.equal(validateDeviceInput({ token: 42, platform: "ios" }).ok, false);
  assert.equal(validateDeviceInput({ token: "x".repeat(30) + " y".repeat(10), platform: "ios" }).ok, false);
  assert.equal(validateDeviceInput(null).ok, false);
  assert.equal(validateDeviceInput("token").ok, false);
});
