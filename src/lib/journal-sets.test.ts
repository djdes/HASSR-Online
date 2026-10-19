import assert from "node:assert/strict";
import test from "node:test";

import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { REGISTER_JOURNALS } from "@/lib/register-journals";
import {
  JOURNAL_SETS,
  JOURNAL_SET_IDS,
  STANDARD_JOURNAL_CODES,
  enableJournalSetCodes,
  isJournalSetId,
  journalSetAllCodes,
  journalSetCodes,
  journalSetStatus,
} from "@/lib/journal-sets";

const catalog = ACTIVE_JOURNAL_CATALOG.map((item) => item.code);
const catalogSet = new Set<string>(catalog);

test("все коды наборов есть в каталоге", () => {
  for (const id of JOURNAL_SET_IDS) {
    for (const code of journalSetAllCodes(JOURNAL_SETS[id])) {
      assert.ok(catalogSet.has(code), `${id}: ${code} нет в каталоге`);
    }
  }
});

test("стандартный набор — 11 пунктов эскиза в его порядке", () => {
  assert.deepEqual(journalSetCodes("standard"), [
    "finished_product",
    "perishable_rejection",
    "hygiene",
    "climate_control",
    "cold_equipment_control",
    "uv_lamp_runtime",
    "general_cleaning",
    "disinfectant_usage",
    "pest_control",
    "med_books",
    "staff_training",
  ]);
  assert.equal(STANDARD_JOURNAL_CODES.length, 11);
  // Журнал здоровья — связанный с гигиеническим, набор его не включает.
  assert.deepEqual(JOURNAL_SETS.standard.items[2].related, ["health_check"]);
  assert.ok(!STANDARD_JOURNAL_CODES.includes("health_check"));
});

test("набор ХАССП — 18 журналов с флагом ХАССП и мониторинг ККТ, в порядке каталога", () => {
  const codes = journalSetCodes("haccp");
  assert.equal(codes.length, 19);
  assert.ok(codes.includes("ccp_monitoring"));
  // `as string[]`: строгий deepEqual сужает тип `codes` до кодов каталога.
  assert.deepEqual(codes, catalog.filter((code) => codes.includes(code)) as string[]);
  // Флаг ХАССП табличных реестров задан в коде — набор с ним не расходится.
  for (const journal of REGISTER_JOURNALS) {
    assert.equal(codes.includes(journal.code), journal.isMandatoryHaccp, journal.code);
  }
});

test("пересечения — только задуманные, «Доп. журналы» вычисляются", () => {
  const standard = new Set(journalSetAllCodes(JOURNAL_SETS.standard));
  const haccp = new Set(journalSetAllCodes(JOURNAL_SETS.haccp));
  const extra = journalSetAllCodes(JOURNAL_SETS.extra);
  // Температурные журналы одновременно СанПиН и ХАССП — это задумано.
  assert.deepEqual(
    [...standard].filter((code) => haccp.has(code)).sort(),
    ["climate_control", "cold_equipment_control"],
  );
  for (const code of extra) {
    assert.ok(!standard.has(code), `${code}: и в стандартном, и в дополнительных`);
    assert.ok(!haccp.has(code), `${code}: и в ХАССП, и в дополнительных`);
  }
  // Каждый журнал каталога — хотя бы в одном наборе, «Доп.» — ровно остаток.
  assert.deepEqual(
    extra,
    catalog.filter((code) => !standard.has(code) && !haccp.has(code)),
  );
  assert.equal(new Set([...standard, ...haccp, ...extra]).size, catalog.length);
  for (const id of JOURNAL_SET_IDS) {
    const codes = journalSetAllCodes(JOURNAL_SETS[id]);
    assert.equal(new Set(codes).size, codes.length, `${id}: дубли`);
  }
});

test("«Включить весь набор» — дельта по основным кодам, идемпотентно", () => {
  const disabled = ["hygiene", "health_check", "pool_water_control", "staff_training", "hygiene"];
  const first = enableJournalSetCodes(disabled, "standard");
  assert.deepEqual(first.enabled, ["hygiene", "staff_training"]);
  // Журнал здоровья и чужие выключенные журналы остаются выключенными.
  assert.deepEqual(first.disabledCodes, ["health_check", "pool_water_control"]);
  const second = enableJournalSetCodes(first.disabledCodes, "standard");
  assert.deepEqual(second.enabled, []);
  assert.deepEqual(second.disabledCodes, first.disabledCodes);
  assert.equal(JOURNAL_SETS.extra.bulkEnable, false);
  assert.equal(JOURNAL_SETS.standard.bulkEnable, true);
  assert.equal(JOURNAL_SETS.haccp.bulkEnable, true);
});

test("статус пунктов и проверка id набора", () => {
  const status = journalSetStatus("standard", new Set(["med_books"]));
  assert.equal(status.length, 11);
  assert.equal(status.find((item) => item.code === "med_books")?.enabled, false);
  assert.equal(status.find((item) => item.code === "hygiene")?.enabled, true);
  assert.ok(isJournalSetId("haccp"));
  assert.ok(!isJournalSetId("all"));
  assert.ok(!isJournalSetId(null));
});
