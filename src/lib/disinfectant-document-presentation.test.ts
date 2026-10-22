import assert from "node:assert/strict";
import test from "node:test";
import type { Locale } from "@/i18n/locales";
import {
  DISINFECTANT_DOCUMENT_TITLE,
  computeNeedPerMonth,
  computeNeedPerTreatment,
  computeNeedPerYear,
  formatNumber,
  formatQuantityWithUnit,
  normalizeDisinfectantConfig,
  resolveSolutionPerTreatment,
  sumDisinfectantQuantities,
  type MeasureUnit,
  type SubdivisionRow,
} from "@/lib/disinfectant-document";
import { sanitationPdfCopy, sanitationQuantity, sanitationQuantityTotal } from "@/lib/sanitation-pest-pdf-presentation";
import { captureDisinfectantTitle, disinfectantQuantity, disinfectantQuantityTotal } from "./disinfectant-document-presentation";

const locales: Locale[] = ["ru", "en", "uz"];
const units: MeasureUnit[] = ["kg", "l", "bottle"];

function unitLabels(locale: Locale) {
  const copy = sanitationPdfCopy(locale);
  return Object.freeze({ kg: copy("kg"), l: copy("l"), bottle: copy("bottle") });
}

test("display units preserve original zero, negative, nonfinite and decimal text across all stable unit codes", () => {
  for (const locale of locales) {
    const copy = sanitationPdfCopy(locale);
    for (const unit of units) for (const value of [0, -0, -1, 0.0001, 0.001, 0.1259, 1, 12500, NaN, Infinity, -Infinity]) {
      const actual = disinfectantQuantity(value, unit, unitLabels(locale));
      const expected = value === 0 ? "" : `${formatNumber(value)} ${copy(unit)}`;
      assert.equal(actual, expected);
      assert.equal(actual, sanitationQuantity(value, unit, locale));
      if (locale === "ru") assert.equal(actual, formatQuantityWithUnit(value, unit));
    }
  }
});

test("mixed-unit totals preserve first-seen order, positive-only filter, zero and original RU aggregate", () => {
  const cases: Array<{ rows: Array<{ quantity: number; unit: MeasureUnit }>; expected: Array<[string, MeasureUnit]> }> = [
    { rows: [], expected: [] },
    { rows: [{ quantity: 0, unit: "kg" }], expected: [] },
    { rows: [{ quantity: 2, unit: "bottle" }, { quantity: 1.125, unit: "kg" }, { quantity: 3, unit: "l" }, { quantity: 0.25, unit: "kg" }],
      expected: [["2", "bottle"], ["1.375", "kg"], ["3", "l"]] },
    { rows: [{ quantity: -1, unit: "kg" }, { quantity: 2, unit: "l" }, { quantity: 1, unit: "kg" }], expected: [["2", "l"]] },
    { rows: [{ quantity: 2, unit: "l" }, { quantity: -3, unit: "l" }, { quantity: 4, unit: "bottle" }], expected: [["4", "bottle"]] },
  ];
  for (const { rows, expected: parts } of cases) {
    const before = structuredClone(rows);
    for (const locale of locales) {
      const copy = sanitationPdfCopy(locale);
      const expected = parts.map(([quantity, unit]) => `${quantity} ${copy(unit)}`).join(" · ") || "—";
      const actual = disinfectantQuantityTotal(rows, unitLabels(locale));
      assert.equal(actual, expected);
      assert.equal(actual, sanitationQuantityTotal(rows, locale));
      if (locale === "ru") assert.equal(actual, sumDisinfectantQuantities(rows));
    }
    assert.deepEqual(rows, before);
  }
});

test("provider-supplied labels stay independent of locale catalogs and preserve raw business quantities", () => {
  const labels = Object.freeze({ kg: "RAW/kg O‘z {unit}", l: "RAW/L", bottle: "RAW/bottle" });
  const rows = [
    { quantity: 2.1259, unit: "bottle" as const },
    { quantity: 0.0001, unit: "kg" as const },
    { quantity: 3, unit: "l" as const },
    { quantity: -1, unit: "l" as const },
  ];
  const before = structuredClone(rows);
  assert.equal(disinfectantQuantity(0, "kg", labels), "");
  assert.equal(disinfectantQuantity(0.0001, "kg", labels), "0 RAW/kg O‘z {unit}");
  assert.equal(disinfectantQuantity(2.1259, "bottle", labels), "2.126 RAW/bottle");
  assert.equal(disinfectantQuantityTotal(rows, labels), "2.126 RAW/bottle · 0 RAW/kg O‘z {unit} · 2 RAW/L");
  assert.deepEqual(rows, before);
  assert.deepEqual(labels, { kg: "RAW/kg O‘z {unit}", l: "RAW/L", bottle: "RAW/bottle" });
});

test("standard title provenance does not classify a custom matching Russian title as fallback", () => {
  for (const value of [DISINFECTANT_DOCUMENT_TITLE, "Customer O‘z <script> {value}", "", "  "]) {
    const captured = captureDisinfectantTitle(value, false);
    assert.deepEqual(captured, { raw: value, standardFallback: false });
  }
  assert.deepEqual(captureDisinfectantTitle(DISINFECTANT_DOCUMENT_TITLE, true), {
    raw: DISINFECTANT_DOCUMENT_TITLE, standardFallback: true,
  });
});

test("retained title capture preserves original interpolation coercion, error identity and timing", () => {
  const hints: string[] = [];
  const value = { [Symbol.toPrimitive](hint: string) { hints.push(hint); return "Captured title"; } };
  const captured = captureDisinfectantTitle(value, false);
  assert.deepEqual(hints, ["string"]);
  assert.equal(captured.raw, "Captured title");
  assert.deepEqual(hints, ["string"]);
  const failure = new TypeError("Original customer coercion failure");
  assert.throws(() => captureDisinfectantTitle({ toString() { throw failure; } }, false), error => error === failure);
  assert.throws(() => captureDisinfectantTitle(Symbol("title"), false), TypeError);
});

test("presentation leaves explicit solution, area fallback, by-capacity and month/year calculations unchanged", () => {
  const row: SubdivisionRow = {
    id: "raw-id", name: "Customer room", area: 120, byCapacity: false, treatmentType: "current",
    frequencyPerMonth: 5, disinfectantName: "Customer reagent", concentration: 2,
    solutionConsumptionPerSqm: 0.5, solutionPerTreatment: 0,
  };
  const before = structuredClone(row);
  assert.equal(resolveSolutionPerTreatment(row), 60);
  assert.equal(computeNeedPerTreatment(row), 1.2);
  assert.equal(computeNeedPerMonth(row), 6);
  assert.equal(computeNeedPerYear(row), 72);
  assert.equal(resolveSolutionPerTreatment({ ...row, solutionPerTreatment: 7 }), 7);
  assert.equal(resolveSolutionPerTreatment({ ...row, byCapacity: true }), 0);
  assert.equal(resolveSolutionPerTreatment({ ...row, area: null }), 0);
  for (const locale of locales) for (const unit of units) disinfectantQuantity(computeNeedPerMonth(row), unit, unitLabels(locale));
  assert.deepEqual(row, before);
});

test("old config normalization retains raw custom names, stable codes, dates, quantities and payload data", () => {
  const raw = {
    responsibleRole: "Custom position O‘z", responsibleEmployeeId: "raw-user", responsibleEmployee: "Raw employee",
    subdivisions: [{ id: "sub", name: "Custom room", area: 25, treatmentType: "general", frequencyPerMonth: 2,
      disinfectantName: "Raw reagent", concentration: 3, solutionConsumptionPerSqm: 0.25, solutionPerTreatment: 0 }],
    receipts: [{ id: "receipt", date: "raw-date", disinfectantName: "Raw reagent", quantity: 2.25, unit: "bottle",
      expiryDate: "raw-expiry", responsibleRole: "Custom position", responsibleEmployee: "Raw employee" }],
    consumptions: [{ id: "consumption", periodFrom: "raw-from", periodTo: "raw-to", disinfectantName: "Raw reagent",
      totalReceived: 1, totalReceivedUnit: "kg", totalConsumed: 2, totalConsumedUnit: "l", remainder: 3, remainderUnit: "bottle",
      responsibleRole: "Custom position", responsibleEmployee: "Raw employee" }],
  };
  const before = structuredClone(raw);
  const normalized = normalizeDisinfectantConfig(raw);
  const payload = JSON.stringify({ title: DISINFECTANT_DOCUMENT_TITLE, config: normalized });
  for (const locale of locales) {
    const labels = unitLabels(locale);
    disinfectantQuantityTotal(normalized.receipts, labels);
    for (const row of normalized.consumptions) {
      disinfectantQuantity(row.totalReceived, row.totalReceivedUnit, labels);
      disinfectantQuantity(row.totalConsumed, row.totalConsumedUnit, labels);
      disinfectantQuantity(row.remainder, row.remainderUnit, labels);
    }
    assert.equal(JSON.stringify({ title: DISINFECTANT_DOCUMENT_TITLE, config: normalized }), payload);
  }
  assert.deepEqual(raw, before);
  assert.equal(normalized.subdivisions[0].treatmentType, "general");
  assert.equal(normalized.receipts[0].unit, "bottle");
  assert.equal(normalized.receipts[0].date, "raw-date");
  assert.equal(normalized.consumptions[0].totalConsumedUnit, "l");
  assert.equal(normalized.responsibleRole, raw.responsibleRole);
});
