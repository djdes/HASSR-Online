import test from "node:test";
import assert from "node:assert/strict";
import { assistantSaveErrorKey, formatAssistantDate } from "./assistant-presentation";

test("failed application error adapter preserves only its exact known key", () => {
  assert.equal(assistantSaveErrorKey("Некорректные данные"), "invalidData");
  for (const value of ["constructor", "__proto__", "RAW NETWORK", "Некорректные данные ", null, 5, {}]) assert.equal(assistantSaveErrorKey(value), "saveFailed");
});

test("native RU/en-GB and healthy numeric Uzbek host seconds are exact", () => {
  for (const value of ["2026-01-01T00:30:01Z", "1960-01-01T00:00:01Z", "0099-01-01T00:00:00Z", "0000-01-01T00:00:00Z", "invalid"]) {
    const date = new Date(value), timestamp = date.getTime();
    for (const locale of ["ru", "en", "uz"] as const) {
      assert.equal(formatAssistantDate(date, locale), date.toLocaleString(locale === "ru" ? "ru-RU" : locale === "en" ? "en-GB" : "uz-Latn-UZ"));
      assert.ok(Object.is(date.getTime(), timestamp));
    }
  }
});
