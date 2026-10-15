import assert from "node:assert/strict";
import test from "node:test";
import { formatChecklistTimestamp } from "./custom-checklist-display";

test("checklist audit dates use the same Moscow day and clock in browser and PDF", () => {
  assert.equal(formatChecklistTimestamp("2026-10-15T22:10:59.000Z"), "16-10-2026, 01:10");
  assert.equal(formatChecklistTimestamp(new Date("2026-12-31T21:00:00.000Z")), "01-01-2027, 00:00");
  assert.equal(formatChecklistTimestamp("invalid"), "—");
});
