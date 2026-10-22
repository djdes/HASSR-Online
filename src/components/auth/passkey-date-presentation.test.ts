import assert from "node:assert/strict";
import test from "node:test";
import { formatPasskeyDate } from "./passkey-date-presentation";

test("passkey dates retain native bare RU/EN and healthy UZ in the current host timezone", () => {
  const values = ["2026-10-16T00:00:00Z", "2026-12-31T21:30:00Z", "2024-02-29T23:30:00Z", "0099-01-01T00:00:00Z", "0000-01-01T00:00:00Z", "-271821-04-20T00:00:00Z", "+275760-09-13T00:00:00Z"];
  for (const locale of ["ru", "en", "uz"] as const) for (const value of values) {
    assert.equal(formatPasskeyDate(value, locale), new Date(value).toLocaleDateString(locale));
  }
  assert.equal(formatPasskeyDate("2026-10-16T12:00:00Z", "en"), new Date("2026-10-16T12:00:00Z").toLocaleDateString("en"));
});

test("invalid passkey date strings keep native Invalid Date text instead of throwing", () => {
  for (const value of ["invalid", "", "2026-99-99", "+275760-09-14T00:00:00Z"]) {
    for (const locale of ["ru", "en", "uz"] as const) {
      assert.equal(formatPasskeyDate(value, locale), new Date(value).toLocaleDateString(locale));
    }
  }
});

test("passkey calendar reads the current host timezone rather than a captured or UTC zone", () => {
  const previous = process.env.TZ;
  try {
    const value = "2026-10-16T00:30:00Z";
    process.env.TZ = "Pacific/Honolulu";
    const west = formatPasskeyDate(value, "uz");
    assert.equal(west, new Date(value).toLocaleDateString("uz"));
    process.env.TZ = "Pacific/Kiritimati";
    const east = formatPasskeyDate(value, "uz");
    assert.equal(east, new Date(value).toLocaleDateString("uz"));
    assert.notEqual(west, east);
    assert.equal(formatPasskeyDate(value, "en"), "10/16/2026");
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
