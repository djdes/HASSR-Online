import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateEntry,
  limitText,
  matchesCcp,
  parseMeasurement,
  summarizeCcp,
  type CcpJournalEntry,
} from "./ccp-monitoring";

const entry = (over: Partial<CcpJournalEntry>): CcpJournalEntry => ({
  id: "e",
  createdAt: "2026-10-10T10:00:00.000Z",
  filledByName: "Иванова А.",
  ccpName: "ККТ-1",
  actualValue: "",
  withinLimit: null,
  correctiveAction: "",
  ...over,
});

test("parseMeasurement: запятая, знак, единицы, мусор", () => {
  assert.equal(parseMeasurement("75,5 °C"), 75.5);
  assert.equal(parseMeasurement("75.5"), 75.5);
  assert.equal(parseMeasurement("+4"), 4);
  assert.equal(parseMeasurement("-18 °С"), -18);
  assert.equal(parseMeasurement("−18"), -18);
  assert.equal(parseMeasurement("  82 "), 82);
  assert.equal(parseMeasurement("норма"), null);
  assert.equal(parseMeasurement(""), null);
});

test("matchesCcp: номер в любой записи и название этапа целиком", () => {
  const point = { number: "ККТ-1", step: "Тепловая обработка" };
  assert.equal(matchesCcp(point, "ККТ-1"), true);
  assert.equal(matchesCcp(point, "ккт 1"), true);
  assert.equal(matchesCcp(point, "ККТ1"), true);
  assert.equal(matchesCcp(point, "ККТ-1 Тепловая обработка"), true);
  assert.equal(matchesCcp(point, "тепловая  обработка"), true);
  assert.equal(matchesCcp(point, "ККТ-12"), false);
  assert.equal(matchesCcp(point, "ККТ-2"), false);
  assert.equal(matchesCcp({ number: "", step: "" }, "ККТ-1"), false);
  assert.equal(matchesCcp({ number: "ККТ-1", step: "" }, ""), false);
});

test("evaluateEntry: пределы приоритетнее withinLimit", () => {
  const between = { limitMin: 2, limitMax: 6 };
  assert.deepEqual(evaluateEntry(between, entry({ actualValue: "4" })), { ok: true, value: 4 });
  assert.deepEqual(evaluateEntry(between, entry({ actualValue: "7", withinLimit: true })), { ok: false, value: 7 });
  assert.equal(evaluateEntry({ limitMin: 75, limitMax: null }, entry({ actualValue: "75" })).ok, true);
  assert.equal(evaluateEntry({ limitMin: 75, limitMax: null }, entry({ actualValue: "68 °C" })).ok, false);
  assert.equal(evaluateEntry({ limitMin: null, limitMax: -18 }, entry({ actualValue: "-20" })).ok, true);
});

test("evaluateEntry: без пределов или без числа — withinLimit, иначе null", () => {
  const none = { limitMin: null, limitMax: null };
  assert.equal(evaluateEntry(none, entry({ actualValue: "10", withinLimit: false })).ok, false);
  assert.equal(evaluateEntry(none, entry({ withinLimit: true })).ok, true);
  assert.equal(evaluateEntry(none, entry({})).ok, null);
  assert.equal(evaluateEntry({ limitMin: 2, limitMax: 6 }, entry({ actualValue: "норма", withinLimit: true })).ok, true);
  assert.equal(evaluateEntry({ limitMin: 2, limitMax: 6 }, entry({ actualValue: "норма" })).ok, null);
});

test("summarizeCcp: последняя запись, отклонения за 30 дней, старые не считаются", () => {
  const point = { limitMin: 75, limitMax: null };
  const now = "2026-10-17T12:00:00.000Z";
  const entries = [
    entry({ id: "a", createdAt: "2026-10-12T14:40:00.000Z", actualValue: "68" }),
    entry({ id: "b", createdAt: "2026-10-14T09:00:00.000Z", actualValue: "80" }),
    entry({ id: "c", createdAt: "2026-10-01T09:00:00.000Z", actualValue: "60" }),
    entry({ id: "old", createdAt: "2026-08-01T09:00:00.000Z", actualValue: "10" }),
  ];
  const s = summarizeCcp(point, entries, now);
  assert.equal(s.last?.id, "b");
  assert.equal(s.last?.ok, true);
  assert.equal(s.deviations30, 2);
  assert.equal(s.lastDeviation?.id, "a");
  assert.equal(s.lastDeviation?.value, 68);
  assert.equal(s.lastOkAt, "2026-10-14T09:00:00.000Z");
});

test("summarizeCcp: нет записей за 30 дней", () => {
  const s = summarizeCcp(
    { limitMin: null, limitMax: null },
    [entry({ createdAt: "2026-01-01T00:00:00.000Z" })],
    "2026-10-17T00:00:00.000Z",
  );
  assert.deepEqual(s, { last: null, deviations30: 0, lastDeviation: null, lastOkAt: null });
});

test("limitText", () => {
  assert.equal(limitText({ limitMin: 75, limitMax: null, unit: "°C" }), "≥ 75 °C");
  assert.equal(limitText({ limitMin: 2, limitMax: 6, unit: "°C" }), "2…6 °C");
  assert.equal(limitText({ limitMin: null, limitMax: -18, unit: "°C" }), "≤ −18 °C");
  assert.equal(limitText({ limitMin: 5, limitMax: null, unit: "" }), "≥ 5");
  assert.equal(limitText({ limitMin: null, limitMax: null, unit: "°C" }), "");
});
