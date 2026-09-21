import assert from "node:assert/strict";
import test from "node:test";

import { describeDateOutsidePeriod } from "@/lib/date-in-period";

const year2027 = { dateFrom: "2027-01-01", dateTo: "2027-12-31" };

test("дата внутри периода — без предупреждения", () => {
  assert.equal(describeDateOutsidePeriod("2027-05-10", year2027), null);
  assert.equal(describeDateOutsidePeriod("2027-01-01", year2027), null);
  assert.equal(describeDateOutsidePeriod("2027-12-31", year2027), null);
});

test("запись за 2026 год в документ на 2027 — предупреждение", () => {
  assert.equal(
    describeDateOutsidePeriod("2026-09-21", year2027),
    "Дата 21.09.2026 вне периода документа (01.01.2027–31.12.2027). Всё равно сохранить?"
  );
  assert.notEqual(describeDateOutsidePeriod("2028-01-01", year2027), null);
});

test("бессрочный документ: верхней границы нет", () => {
  const perpetual = { dateFrom: "2026-09-01", dateTo: "2099-12-31" };
  assert.equal(describeDateOutsidePeriod("2031-01-01", perpetual), null);
  assert.equal(
    describeDateOutsidePeriod("2026-08-31", perpetual),
    "Дата 31.08.2026 вне периода документа (с 01.09.2026). Всё равно сохранить?"
  );
});

test("нет даты или периода — молчим", () => {
  assert.equal(describeDateOutsidePeriod("", year2027), null);
  assert.equal(describeDateOutsidePeriod("2026-09-21", { dateFrom: "" }), null);
});
