import assert from "node:assert/strict";
import test from "node:test";

import { presentStatusTimestamp } from "./status-presentation";

test("Russian timestamps retain native host-zone output, seconds and invalid-date behavior", () => {
  const value = "2026-10-15T23:30:01.000Z";
  assert.equal(presentStatusTimestamp(value, "ru").kind, "native");
  const result = presentStatusTimestamp(value, "ru");
  assert.deepEqual(result, { kind: "native", text: new Date(value).toLocaleString("ru-RU") });
  assert.deepEqual(presentStatusTimestamp("bad-date", "ru"), {
    kind: "native",
    text: new Date("bad-date").toLocaleString("ru-RU"),
  });
});

test("English and Uzbek timestamps retain host-local time and explicit seconds", () => {
  const value = "2026-10-15T23:30:01.000Z";
  for (const locale of ["en", "uz"] as const) {
    const result = presentStatusTimestamp(value, locale);
    assert.equal(result.kind, "localized");
    if (result.kind !== "localized") continue;
    assert.match(result.date, /2026/);
    assert.match(result.time, /:\d{2}:\d{2}/);
  }
  assert.deepEqual(presentStatusTimestamp("bad-date", "uz"), { kind: "invalid" });
});
