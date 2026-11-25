import assert from "node:assert/strict";
import test from "node:test";
import { issueAdTouch, readAdTouch } from "./ad-campaign-cookie.server";
import { AD_CAMPAIGN_ID, AD_CAMPAIGN_MAX_AGE } from "./ad-campaign";

test("campaign cookie authenticates a stable browser identifier and expires", () => {
  const now = 1_800_000_000_000;
  const token = issueAdTouch(now, "secret")!;
  const touch = readAdTouch(token, now, "secret")!;
  assert.equal(touch.id, AD_CAMPAIGN_ID);
  assert.equal(readAdTouch(token, now + 1000, "secret")?.visitorId, touch.visitorId);
  assert.notEqual(readAdTouch(issueAdTouch(now, "secret"), now, "secret")?.visitorId, touch.visitorId);
  assert.equal(readAdTouch(token, now + AD_CAMPAIGN_MAX_AGE * 1000, "secret"), null);
  assert.equal(readAdTouch(token, now - 1, "secret"), null);
  assert.equal(readAdTouch(token, now, "other-secret"), null);
  assert.equal(readAdTouch(token.slice(0, -1) + "!", now, "secret"), null);
  assert.equal(readAdTouch(token + ".extra", now, "secret"), null);
  assert.equal(readAdTouch("x".repeat(600), now, "secret"), null);
});
