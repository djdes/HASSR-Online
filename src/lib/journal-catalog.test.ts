import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_JOURNAL_CATALOG,
  ACTIVE_JOURNAL_TEMPLATES,
  BASIC_TARIFF_JOURNALS,
  EXTENDED_ONLY_TARIFF_JOURNALS,
  JOURNAL_TARIFFS,
  JOURNALS_TOTAL,
  SCHOOL_JOURNAL_CODES_IN_BASIC,
  isBasicTariffJournal,
  journalsCountLabel,
} from "@/lib/journal-catalog";
import { PLANS } from "@/lib/plans";

// Порядок каталога на 2026-09-24: он задаёт sortOrder шаблонов и порядок в
// интерфейсе. Перевод журнала между тарифами не должен его менять.
const CATALOG_ORDER_2026_09_24 = [
  "hygiene", "health_check", "climate_control", "cold_equipment_control",
  "cleaning_ventilation_checklist", "cleaning", "general_cleaning", "uv_lamp_runtime",
  "finished_product", "perishable_rejection", "incoming_control", "fryer_oil", "med_books",
  "training_plan", "staff_training", "disinfectant_usage", "sanitary_day_control",
  "equipment_maintenance", "breakdown_history", "equipment_calibration",
  "incoming_raw_materials_control", "ppe_issuance", "accident_journal", "complaint_register",
  "product_writeoff", "audit_plan", "audit_protocol", "audit_report", "traceability_test",
  "metal_impurity", "equipment_cleaning", "intensive_cooling", "glass_items_list",
  "glass_control", "pest_control", "daily_samples", "vitaminization", "ration_control",
  "transport_temperature", "tableware_breakage", "pool_water_control", "inventory_condition",
  "instrument_sterilization", "medical_waste_b", "batch_release",
];

test("порядок каталога и sortOrder не изменились", () => {
  assert.deepEqual(
    ACTIVE_JOURNAL_CATALOG.map((item) => item.code),
    CATALOG_ORDER_2026_09_24,
  );
  ACTIVE_JOURNAL_TEMPLATES.forEach((item, index) => {
    assert.equal(item.sortOrder, index + 1, item.code);
  });
  const sortOrder = new Map(ACTIVE_JOURNAL_TEMPLATES.map((item) => [item.code, item.sortOrder]));
  assert.equal(sortOrder.get("daily_samples"), 36);
  assert.equal(sortOrder.get("vitaminization"), 37);
  assert.equal(sortOrder.get("ration_control"), 38);
});

test("журналы для школ — в базовом тарифе", () => {
  assert.deepEqual([...SCHOOL_JOURNAL_CODES_IN_BASIC], ["daily_samples", "vitaminization", "ration_control"]);
  const basic = new Set(BASIC_TARIFF_JOURNALS.map((item) => item.code));
  const extendedOnly = new Set(EXTENDED_ONLY_TARIFF_JOURNALS.map((item) => item.code));
  for (const code of SCHOOL_JOURNAL_CODES_IN_BASIC) {
    assert.ok(basic.has(code), `${code} в базовом`);
    assert.ok(!extendedOnly.has(code), `${code} не «только в расширенном»`);
    assert.ok(isBasicTariffJournal(code), code);
  }
  // Прежние 13 базовых остались базовыми, расширенные — нет.
  for (const code of CATALOG_ORDER_2026_09_24.slice(0, 13)) assert.ok(isBasicTariffJournal(code), code);
  assert.ok(!isBasicTariffJournal("training_plan"));
  assert.ok(!isBasicTariffJournal("pool_water_control"));
  assert.equal(BASIC_TARIFF_JOURNALS.length, 16);
});

test("тарифы делят каталог без пересечений и в порядке каталога", () => {
  const basic: string[] = BASIC_TARIFF_JOURNALS.map((item) => item.code);
  const extendedOnly: string[] = EXTENDED_ONLY_TARIFF_JOURNALS.map((item) => item.code);
  assert.equal(basic.length + extendedOnly.length, JOURNALS_TOTAL);
  assert.equal(new Set([...basic, ...extendedOnly]).size, JOURNALS_TOTAL);
  const order = CATALOG_ORDER_2026_09_24;
  assert.deepEqual(basic, order.filter((code) => basic.includes(code)));
  assert.deepEqual(extendedOnly, order.filter((code) => extendedOnly.includes(code)));
  assert.equal(JOURNAL_TARIFFS.basic.journals, BASIC_TARIFF_JOURNALS);
  assert.equal(JOURNAL_TARIFFS.extended.journals.length, JOURNALS_TOTAL);
  assert.equal(JOURNAL_TARIFFS.extended.extraJournals, EXTENDED_ONLY_TARIFF_JOURNALS);
});

test("числа журналов тарифов в планах считаются из каталога", () => {
  assert.ok(
    PLANS.starter.features.includes(`Тариф "Базовый": ${journalsCountLabel(BASIC_TARIFF_JOURNALS.length)}`),
    PLANS.starter.features.join(" | "),
  );
  assert.ok(
    PLANS.standard.features.some((line) =>
      line.startsWith(`Тариф "Расширенный": ${journalsCountLabel(JOURNALS_TOTAL)}`),
    ),
    PLANS.standard.features.join(" | "),
  );
  assert.ok(
    PLANS.standard.features.some((line) =>
      line.includes(`и еще ${EXTENDED_ONLY_TARIFF_JOURNALS.length - 3}`),
    ),
  );
});
