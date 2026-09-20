import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

process.env.KIOSK_DEVICE_SECRET = "test-kiosk-secret-0123456789abcdef";

let mint: typeof import("./kiosk-device").mintKioskDeviceToken;
let verify: typeof import("./kiosk-device").verifyKioskDeviceToken;

before(async () => {
  const mod = await import("./kiosk-device");
  mint = mod.mintKioskDeviceToken;
  verify = mod.verifyKioskDeviceToken;
});

describe("kiosk device token", () => {
  it("round-trips a device id", () => {
    const token = mint("dev_abc123");
    const res = verify(token);
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.deviceId, "dev_abc123");
  });

  it("rejects a tampered signature", () => {
    const token = mint("dev_abc123");
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    assert.equal(verify(tampered).ok, false);
  });

  it("rejects a swapped device id", () => {
    const token = mint("dev_one");
    const sig = token.slice(token.lastIndexOf(".") + 1);
    assert.equal(verify(`dev_two.${sig}`).ok, false);
  });

  it("rejects empty / malformed tokens", () => {
    assert.equal(verify(null).ok, false);
    assert.equal(verify("").ok, false);
    assert.equal(verify("no-dot").ok, false);
    assert.equal(verify(".sig").ok, false);
  });

  it("refuses to mint an id containing a dot", () => {
    assert.throws(() => mint("dev.bad"));
  });
});
