import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatHygienePeriodBounds } from "@/lib/hygiene-period-format";

describe("formatHygienePeriodBounds", () => {
  it("localizes both ends while retaining the exact partial-period dates", () => {
    const ru = formatHygienePeriodBounds("2026-09-01", "2026-09-15", "ru");
    const en = formatHygienePeriodBounds("2026-09-01", "2026-09-15", "en");
    const uz = formatHygienePeriodBounds("2026-09-01", "2026-09-15", "uz");
    assert.notEqual(ru.from, en.from);
    assert.notEqual(en.from, uz.from);
    assert.match(ru.from, /1/);
    assert.match(ru.to, /15/);
    assert.match(en.from, /1/);
    assert.match(en.to, /15/);
    assert.match(uz.from, /1/);
    assert.match(uz.to, /15/);
  });

  it("keeps date-only bounds stable regardless of runtime timezone", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Honolulu";
      const west = formatHygienePeriodBounds("2026-01-01", "2026-01-15", "en");
      process.env.TZ = "Pacific/Kiritimati";
      const east = formatHygienePeriodBounds("2026-01-01", "2026-01-15", "en");
      assert.deepEqual(east, west);
      assert.match(east.from, /1/);
      assert.match(east.to, /15/);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
