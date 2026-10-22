import assert from "node:assert/strict";
import { test } from "node:test";
import { formatNpsTimestamp } from "./nps-presentation";

test("Russian timestamps retain native host-local bytes, seconds, and invalid-date behavior", () => {
  const dates = [
    new Date("2026-01-01T00:00:00.000Z"),
    new Date("2026-10-31T23:59:59.999Z"),
    new Date("2026-03-29T01:30:00.000Z"),
    new Date("not-a-date"),
  ];
  for (const date of dates) {
    assert.equal(formatNpsTimestamp(date, "ru", "ignored"), date.toLocaleString("ru-RU"));
  }
});

test("foreign timestamp display keeps host timezone and explicit seconds", () => {
  const date = new Date("2026-12-31T23:30:00.321Z");
  for (const locale of ["en", "uz"] as const) {
    const actual = formatNpsTimestamp(date, locale, "invalid");
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const dateText = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "uz-Latn-UZ", {
      timeZone: zone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).format(date);
    const timeText = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "uz-Latn-UZ", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(date);
    assert.equal(actual, `${dateText} ${timeText}`);
    assert.match(actual, /:\d{2}$/);
    assert.equal(formatNpsTimestamp(new Date("invalid"), locale, "localized invalid"), "localized invalid");
  }
});
