import assert from "node:assert/strict";
import test from "node:test";

process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "test-secret-for-inspector-qr-0123456789";

import {
  INSPECTOR_QR_OPEN_PERIOD_TO,
  INSPECTOR_QR_TTL_DAYS,
  deriveInspectorQrToken,
  documentOverlaps,
  inspectorControlCode,
  inspectorWindow,
  isInspectorQrRecord,
  resolveInspectorPeriod,
  shiftDayKey,
} from "@/lib/inspector-qr";
import { hashInspectorToken } from "@/lib/inspector-tokens";

test("токен QR выводится детерминированно из id строки", () => {
  const a = deriveInspectorQrToken("tok_1");
  assert.equal(a, deriveInspectorQrToken("tok_1"));
  assert.notEqual(a, deriveInspectorQrToken("tok_2"));
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  // В базе по-прежнему sha256 — повторная печать даёт тот же хэш.
  assert.equal(hashInspectorToken(a), hashInspectorToken(deriveInspectorQrToken("tok_1")));
});

test("токен QR зависит от секрета", () => {
  const before = deriveInspectorQrToken("tok_1");
  const saved = process.env.EQUIPMENT_QR_TOKEN_SECRET;
  process.env.EQUIPMENT_QR_TOKEN_SECRET = "another-secret-for-inspector-qr-9876543210";
  try {
    assert.notEqual(deriveInspectorQrToken("tok_1"), before);
  } finally {
    process.env.EQUIPMENT_QR_TOKEN_SECRET = saved;
  }
});

test("сроки действия QR: 1, 7, 30 дней и «до отзыва» = 365", () => {
  assert.deepEqual(INSPECTOR_QR_TTL_DAYS, { "1d": 1, "7d": 7, "30d": 30, forever: 365 });
});

test("QR-токен узнаётся по открытому периоду 2099-12-31", () => {
  assert.equal(isInspectorQrRecord({ periodTo: INSPECTOR_QR_OPEN_PERIOD_TO }), true);
  assert.equal(isInspectorQrRecord({ periodTo: new Date("2026-09-30T00:00:00.000Z") }), false);
});

test("окно QR — от periodFrom до сегодня, у старой ссылки — её период", () => {
  const today = "2026-09-23";
  assert.deepEqual(
    inspectorWindow({ periodFrom: new Date("2025-09-23T00:00:00.000Z"), periodTo: INSPECTOR_QR_OPEN_PERIOD_TO }, today),
    { from: "2025-09-23", to: "2026-09-23" }
  );
  assert.deepEqual(
    inspectorWindow({ periodFrom: new Date("2026-08-01T00:00:00.000Z"), periodTo: new Date("2026-08-31T23:59:59.999Z") }, today),
    { from: "2026-08-01", to: "2026-08-31" }
  );
});

test("сдвиг дня по ключу YYYY-MM-DD", () => {
  assert.equal(shiftDayKey("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDayKey("2026-09-23", -6), "2026-09-17");
});

const WINDOW = { from: "2025-09-23", to: "2026-09-23" };

test("пресеты периода считаются от сегодня и включают сегодняшний день", () => {
  const t = "2026-09-23";
  assert.deepEqual(resolveInspectorPeriod({ window: WINDOW, today: t, preset: "today" }), { preset: "today", from: t, to: t });
  assert.deepEqual(resolveInspectorPeriod({ window: WINDOW, today: t, preset: "7d" }), { preset: "7d", from: "2026-09-17", to: t });
  assert.deepEqual(resolveInspectorPeriod({ window: WINDOW, today: t, preset: "month" }), { preset: "month", from: "2026-08-25", to: t });
  assert.deepEqual(resolveInspectorPeriod({ window: WINDOW, today: t, preset: "quarter" }), { preset: "quarter", from: "2026-06-26", to: t });
});

test("по умолчанию — месяц; неизвестный пресет тоже даёт месяц", () => {
  const t = "2026-09-23";
  assert.equal(resolveInspectorPeriod({ window: WINDOW, today: t }).preset, "month");
  assert.equal(resolveInspectorPeriod({ window: WINDOW, today: t, preset: "evil" }).preset, "month");
});

test("свои даты зажимаются окном и переставляются местами", () => {
  const t = "2026-09-23";
  assert.deepEqual(
    resolveInspectorPeriod({ window: WINDOW, today: t, preset: "custom", from: "2020-01-01", to: "2030-01-01" }),
    { preset: "custom", from: "2025-09-23", to: "2026-09-23" }
  );
  assert.deepEqual(
    resolveInspectorPeriod({ window: WINDOW, today: t, preset: "custom", from: "2026-09-10", to: "2026-09-01" }),
    { preset: "custom", from: "2026-09-01", to: "2026-09-10" }
  );
});

test("битые даты в «своих» падают на месяц", () => {
  const r = resolveInspectorPeriod({ window: WINDOW, today: "2026-09-23", preset: "custom", from: "2026-13-99", to: "x" });
  assert.equal(r.preset, "month");
});

test("пресет старой ссылки зажимается её фиксированным окном", () => {
  const legacy = { from: "2026-08-01", to: "2026-08-31" };
  const r = resolveInspectorPeriod({ window: legacy, today: "2026-09-23", preset: "7d" });
  // Сегодня вне окна — период прижимается к концу окна.
  assert.deepEqual(r, { preset: "7d", from: "2026-08-31", to: "2026-08-31" });
});

test("документ пересекается с периодом по датам включительно", () => {
  const doc = (from: string, to: string) => ({
    dateFrom: new Date(`${from}T00:00:00.000Z`),
    dateTo: new Date(`${to}T00:00:00.000Z`),
  });
  assert.equal(documentOverlaps(doc("2026-09-01", "2026-09-30"), "2026-09-23", "2026-09-23"), true);
  assert.equal(documentOverlaps(doc("2026-08-01", "2026-08-31"), "2026-08-31", "2026-09-10"), true);
  assert.equal(documentOverlaps(doc("2026-08-01", "2026-08-31"), "2026-09-01", "2026-09-10"), false);
  assert.equal(documentOverlaps(doc("2026-10-01", "2026-10-31"), "2025-09-23", "2026-09-23"), false);
  // Бессрочный документ
  assert.equal(documentOverlaps(doc("2026-01-01", "2099-12-31"), "2026-09-01", "2026-09-10"), true);
});

test("контрольный код: стабилен для одного содержимого, меняется при правке", () => {
  const a = inspectorControlCode(["doc1", "2026-09-01T10:00:00.000Z", "e1:2026-09-02T10:00:00.000Z"]);
  assert.equal(a, inspectorControlCode(["doc1", "2026-09-01T10:00:00.000Z", "e1:2026-09-02T10:00:00.000Z"]));
  assert.notEqual(a, inspectorControlCode(["doc1", "2026-09-01T10:00:00.000Z", "e1:2026-09-03T10:00:00.000Z"]));
  assert.match(a, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
});
