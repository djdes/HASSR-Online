import test from "node:test";
import assert from "node:assert/strict";
import { blankFormatLabel, formatBlankDownloadDate } from "./blank-download-presentation";

test("known format labels and unknown historical text remain literal, including prototype names", () => {
  assert.equal(blankFormatLabel("pdf"), "PDF");
  assert.equal(blankFormatLabel("docx"), "Word");
  for (const raw of ["constructor", "__proto__", "toString", "PDF", "Word", "Формат", "", "custom"]) assert.equal(blankFormatLabel(raw), raw);
});

test("Moscow minute profile equals native healthy RU/EN/UZ without altering Date", () => {
  for (const value of ["2026-01-01T22:30:59Z", "1960-02-29T23:30:01Z", "0099-01-01T00:00:00Z", "0000-01-01T00:00:00Z", "invalid"]) {
    const date = new Date(value), timestamp = date.getTime();
    for (const locale of ["ru", "en", "uz"] as const) {
      assert.equal(formatBlankDownloadDate(date, locale), date.toLocaleString(locale === "ru" ? "ru-RU" : locale === "en" ? "en-GB" : "uz-Latn-UZ", {timeZone:"Europe/Moscow",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}));
      assert.ok(Object.is(date.getTime(), timestamp));
    }
  }
});
