import assert from "node:assert/strict";
import { test } from "node:test";

import { buildFillHistory, historyToPlain } from "./history";

const at = (iso: string) => new Date(iso);

test("latest submission of a row and day wins, field by field", () => {
  const map = buildFillHistory([
    { entityId: "doc1", createdAt: at("2026-11-03T10:00:00Z"), details: { kind: "journal", rowKey: "employee-u1", dateKey: "2026-11-03", values: { temp: 36.6, note: "ок" } } },
    { entityId: "doc1", createdAt: at("2026-11-03T08:00:00Z"), details: { kind: "journal", rowKey: "employee-u1", dateKey: "2026-11-03", values: { temp: 37.2 } } },
    { entityId: "doc1", createdAt: at("2026-11-03T12:00:00Z"), details: { kind: "journal", rowKey: "employee-u1", dateKey: "2026-11-03", values: { note: "" } } },
  ]);
  assert.deepEqual(historyToPlain(map.get("doc1")), { "employee-u1": { "2026-11-03": { temp: 36.6, note: null } } });
});

test("rows, days and documents do not mix; foreign audit rows are skipped", () => {
  const map = buildFillHistory([
    { entityId: "doc1", createdAt: at("2026-11-03T10:00:00Z"), details: { kind: "journal", rowKey: "r1", dateKey: "2026-11-03", values: { a: 1 } } },
    { entityId: "doc1", createdAt: at("2026-11-04T10:00:00Z"), details: { kind: "journal", rowKey: "r1", dateKey: "2026-11-04", values: { a: 2 } } },
    { entityId: "doc2", createdAt: at("2026-11-03T10:00:00Z"), details: { kind: "journal", rowKey: "r1", dateKey: "2026-11-03", values: { a: 3 } } },
    // Append journals carry no rowKey; stickers are another kind.
    { entityId: "doc1", createdAt: at("2026-11-03T10:00:00Z"), details: { kind: "journal", dateKey: "2026-11-03", values: { a: 9 } } },
    { entityId: "eq1", createdAt: at("2026-11-03T10:00:00Z"), details: { kind: "equipment", rowKey: "r1", dateKey: "2026-11-03", values: { a: 9 } } },
    { entityId: null, createdAt: at("2026-11-03T10:00:00Z"), details: null },
  ]);
  assert.deepEqual(historyToPlain(map.get("doc1")), { r1: { "2026-11-03": { a: 1 }, "2026-11-04": { a: 2 } } });
  assert.deepEqual(historyToPlain(map.get("doc2")), { r1: { "2026-11-03": { a: 3 } } });
  assert.equal(map.has("eq1"), false);
});
