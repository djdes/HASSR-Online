import assert from "node:assert/strict";
import { test } from "node:test";

import { offlineRecordRows } from "./overview";

test("only records made without network are listed, newest first, with the delay", () => {
  const rows = offlineRecordRows([
    {
      id: "a",
      userName: "Анна (QR)",
      createdAt: new Date("2026-11-10T10:00:05Z"),
      details: { kind: "equipment", objectName: "Холодильник №2", dateKey: "2026-11-10", offline: { recordedAt: "2026-11-10T08:00:00Z", syncedAt: "2026-11-10T10:00:00Z", auth: "pin" } },
    },
    { id: "b", userName: "Пётр (QR)", createdAt: new Date("2026-11-10T11:00:00Z"), details: { kind: "journal", objectName: "Гигиена", dateKey: "2026-11-10" } },
    {
      id: "c",
      userName: "Пётр",
      createdAt: new Date("2026-11-10T12:00:00Z"),
      details: { kind: "journal", objectName: "Гигиена", dateKey: "2026-11-08", offline: { recordedAt: "2026-11-10T11:59:00Z", syncedAt: "2026-11-10T12:00:00Z", auth: "self", pastDayEdit: true } },
    },
    { id: "d", userName: null, createdAt: new Date("2026-11-10T12:00:00Z"), details: { offline: { recordedAt: "мусор" } } },
  ]);
  assert.deepEqual(
    rows.map((row) => [row.id, row.who, row.what, row.pastDay, row.delayMinutes, row.auth]),
    [
      ["c", "Пётр", "Гигиена", "08.11", 1, "self"],
      ["a", "Анна", "Холодильник №2", null, 120, "pin"],
    ],
  );
});
