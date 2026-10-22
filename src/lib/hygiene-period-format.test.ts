import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatHygienePeriodBounds } from "@/lib/hygiene-period-format";

describe("formatHygienePeriodBounds", () => {
  it("retains native healthy date bytes for all months and leap/year boundaries", () => {
    const locales = { ru: "ru-RU", en: "en-GB", uz: "uz-Latn-UZ" } as const;
    const dates = [...Array.from({ length: 12 }, (_, month) => `2026-${String(month + 1).padStart(2, "0")}-16`), "2024-02-29", "2026-12-31", "2027-01-01"];
    for (const locale of ["ru", "en", "uz"] as const) for (const date of dates) {
      const value = new Date(`${date}T00:00:00Z`);
      const expected = new Intl.DateTimeFormat(locales[locale], { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(value);
      assert.deepEqual(formatHygienePeriodBounds(date, value, locale), { from: expected, to: expected });
      assert.equal(value.toISOString().slice(0, 10), date);
    }
    for (const locale of ["ru", "en", "uz"] as const) assert.throws(() => formatHygienePeriodBounds("invalid", "2026-01-01", locale), RangeError);
  });

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
