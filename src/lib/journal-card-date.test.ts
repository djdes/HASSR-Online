import assert from "node:assert/strict";
import test from "node:test";

import { formatCardDateTime } from "@/lib/journal-card-date";

test("три прежних формата приводятся к одному", () => {
  // Скоропорт показывал «2026-09-15 09:00»…
  assert.equal(formatCardDateTime("2026-09-15", "09:00"), "15.09.2026 09:00");
  // …входной контроль и жалобы — «18-09-2026 09:30»…
  assert.equal(formatCardDateTime("18-09-2026", "09:30"), "18.09.2026 09:30");
  // …фритюр — «01.09.2026».
  assert.equal(formatCardDateTime("01.09.2026"), "01.09.2026");
});

test("времени нет — остаётся одна дата", () => {
  assert.equal(formatCardDateTime("2026-09-15"), "15.09.2026");
  assert.equal(formatCardDateTime("2026-09-15", ""), "15.09.2026");
  assert.equal(formatCardDateTime("2026-09-15", null), "15.09.2026");
});

test("часы и минуты дополняются нулём", () => {
  assert.equal(formatCardDateTime("2026-09-15", "9:5"), "15.09.2026 09:05");
});

test("пусто на входе — пусто на выходе", () => {
  assert.equal(formatCardDateTime(""), "");
  assert.equal(formatCardDateTime(null), "");
  assert.equal(formatCardDateTime(undefined), "");
});

test("непонятную строку не теряем, а показываем как есть", () => {
  assert.equal(formatCardDateTime("не указана"), "не указана");
  assert.equal(formatCardDateTime("не указана", "09:00"), "не указана 09:00");
});

test("мусорное время отбрасывается, дата остаётся", () => {
  assert.equal(formatCardDateTime("2026-09-15", "утром"), "15.09.2026");
});
