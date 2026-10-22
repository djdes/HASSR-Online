import assert from "node:assert/strict";
import test from "node:test";
import { formatRootTimingDuration, rootOperationsCopy, rootTelegramStatus } from "./root-operations-logs-presentation";

test("duration display keeps thresholds and rounding across three locales", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = rootOperationsCopy(locale);
    for (const value of [-15, 0, 999]) assert.equal(formatRootTimingDuration(value, locale), t("duration.milliseconds", { value }));
    for (const [ms, value] of [[1000, 1], [1499, 1], [1500, 2], [59499, 59]]) assert.equal(formatRootTimingDuration(ms, locale), t("duration.seconds", { value }));
    for (const ms of [59500, 60000, 60499]) assert.equal(formatRootTimingDuration(ms, locale), t("duration.minutes", { value: 1 }));
    assert.equal(formatRootTimingDuration(60500, locale), t("duration.minutesSeconds", { minutes: 1, seconds: 1 }));
    assert.equal(formatRootTimingDuration(120000, locale), t("duration.minutes", { value: 2 }));
  }
});

test("known delivery statuses translate; unknown and object-like values stay literal", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = rootOperationsCopy(locale);
    for (const value of ["sent", "queued", "failed", "rate_limited", "push_only", "deferred"] as const) assert.equal(rootTelegramStatus(value, locale), t(`statuses.${value}`));
    for (const value of ["constructor", "__proto__", "toString", "CUSTOM STATUS", "", "sent "]) assert.equal(rootTelegramStatus(value, locale), value);
  }
});
