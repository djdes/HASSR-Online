import assert from "node:assert/strict";
import test from "node:test";

import { VISION_DAILY_LIMIT_ORG, VISION_DAILY_LIMIT_USER, checkVisionQuota } from "@/lib/ai-vision/quota";

test("лимиты по умолчанию: 20 на сотрудника и 60 на организацию в сутки", () => {
  assert.equal(VISION_DAILY_LIMIT_USER, 20);
  assert.equal(VISION_DAILY_LIMIT_ORG, 60);
});

test("до лимита — можно, с остатком после этого распознавания", () => {
  assert.deepEqual(checkVisionQuota({ user: 0, org: 0 }), { ok: true, remainingUser: 19, remainingOrg: 59 });
  assert.deepEqual(checkVisionQuota({ user: 19, org: 59 }), { ok: true, remainingUser: 0, remainingOrg: 0 });
});

test("20-е за сутки у сотрудника было — 21-е нельзя, понятный текст", () => {
  const verdict = checkVisionQuota({ user: 20, org: 20 });
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.scope, "user");
  assert.match(verdict.error, /не больше 20 в сутки на сотрудника/);
  assert.match(verdict.error, /Заполните вручную или попробуйте завтра/);
});

test("организация выбрала 60 — нельзя даже новому сотруднику", () => {
  const verdict = checkVisionQuota({ user: 0, org: 60 });
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.scope, "org");
  assert.match(verdict.error, /\(60\)/);
});

test("свои лимиты", () => {
  assert.equal(checkVisionQuota({ user: 2, org: 2 }, { user: 2, org: 10 }).ok, false);
  assert.equal(checkVisionQuota({ user: 1, org: 9 }, { user: 2, org: 10 }).ok, true);
});
