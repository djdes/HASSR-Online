import assert from "node:assert/strict";
import test from "node:test";

import { CLIMATE_DOCUMENT_TITLE, getClimateDocumentTitle } from "@/lib/climate-document";
import {
  COLD_EQUIPMENT_DOCUMENT_TITLE,
  COLD_EQUIPMENT_LEGAL_BASIS,
  getColdEquipmentDocumentTitle,
} from "@/lib/cold-equipment-document";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { JOURNAL_TITLE_RENAMES, renamedJournalDocumentTitle } from "@/lib/journal-title-renames";

const catalogName = (code: string) => ACTIVE_JOURNAL_CATALOG.find((item) => item.code === code)?.name;

test("журналы температуры: новые названия в каталоге, у документов и в списке переименований", () => {
  assert.equal(catalogName("climate_control"), "Журнал учёта температуры и влажности на складах");
  assert.equal(
    catalogName("cold_equipment_control"),
    "Журнал учёта температурного режима холодильного и морозильного оборудования",
  );
  assert.equal(CLIMATE_DOCUMENT_TITLE, catalogName("climate_control"));
  assert.equal(getClimateDocumentTitle(), CLIMATE_DOCUMENT_TITLE);
  assert.equal(COLD_EQUIPMENT_DOCUMENT_TITLE, catalogName("cold_equipment_control"));
  assert.equal(getColdEquipmentDocumentTitle(), COLD_EQUIPMENT_DOCUMENT_TITLE);
  // Сид и печать берут новые названия из списка переименований — он не
  // должен разойтись с каталогом.
  for (const rename of JOURNAL_TITLE_RENAMES) {
    assert.equal(rename.title, catalogName(rename.code), rename.code);
    assert.ok(!rename.legacyTitles.includes(rename.title), `${rename.code}: новое название не в списке старых`);
  }
  assert.equal(COLD_EQUIPMENT_LEGAL_BASIS, "Приложение № 2 к СанПиН 2.3/2.4.4282-26");
});

test("в названиях журналов каталога нет слова «бланк»", () => {
  for (const item of ACTIVE_JOURNAL_CATALOG) {
    assert.doesNotMatch(item.name, /бланк/i, `${item.code}: «${item.name}»`);
  }
});

test("заголовок документа: старое название → новое, период после тире сохраняется, своё название — как есть", () => {
  assert.equal(
    renamedJournalDocumentTitle("climate_control", "Бланк контроля температуры и влажности на складах"),
    "Журнал учёта температуры и влажности на складах",
  );
  assert.equal(
    renamedJournalDocumentTitle("climate_control", "Бланк контроля температуры и влажности"),
    "Журнал учёта температуры и влажности на складах",
  );
  assert.equal(
    renamedJournalDocumentTitle(
      "cold_equipment_control",
      "Журнал контроля температурного режима холодильного и морозильного оборудования — 1–15 сентября 2026",
    ),
    "Журнал учёта температурного режима холодильного и морозильного оборудования — 1–15 сентября 2026",
  );
  // Свои названия и другие журналы не трогаем.
  assert.equal(renamedJournalDocumentTitle("climate_control", "Склад №2 — сентябрь"), "Склад №2 — сентябрь");
  assert.equal(
    renamedJournalDocumentTitle("cold_equipment_control", "Журнал контроля температурного режима холодильного цеха"),
    "Журнал контроля температурного режима холодильного цеха",
  );
  assert.equal(renamedJournalDocumentTitle("hygiene", "Бланк контроля температуры и влажности"), "Бланк контроля температуры и влажности");
  // Новое название — неподвижная точка (сид идемпотентен).
  for (const rename of JOURNAL_TITLE_RENAMES) {
    assert.equal(renamedJournalDocumentTitle(rename.code, rename.title), rename.title);
    assert.equal(renamedJournalDocumentTitle(rename.code, `${rename.title} — сентябрь 2026`), `${rename.title} — сентябрь 2026`);
  }
});

test("заголовки документов с прода: прежний разделитель « · » и «(демо)» тоже переименовываются", () => {
  // Так названы 199 документов на проде (29.09.2026): до сентября автоназвание
  // писалось через « · », а сид ждал только « — ».
  const cases: Array<[string, string, string]> = [
    [
      "climate_control",
      "Бланк контроля температуры и влажности · Сентябрь 2026 г.",
      "Журнал учёта температуры и влажности на складах · Сентябрь 2026 г.",
    ],
    [
      "climate_control",
      "Бланк контроля температуры и влажности на складах · с 1 сентября по 30 сентября",
      "Журнал учёта температуры и влажности на складах · с 1 сентября по 30 сентября",
    ],
    [
      "cold_equipment_control",
      "Журнал контроля температурного режима холодильного и морозильного оборудования · Сентябрь с 1 по 15",
      "Журнал учёта температурного режима холодильного и морозильного оборудования · Сентябрь с 1 по 15",
    ],
    [
      "cold_equipment_control",
      "Журнал контроля температурного режима холодильного и морозильного оборудования (демо)",
      "Журнал учёта температурного режима холодильного и морозильного оборудования (демо)",
    ],
  ];
  for (const [code, before, after] of cases) {
    assert.equal(renamedJournalDocumentTitle(code, before), after, before);
    // Повторный прогон сида ничего не меняет.
    assert.equal(renamedJournalDocumentTitle(code, after), after);
  }
  // Более короткое старое название — не «хвост» более длинного: без « на складах» не удваивается.
  assert.doesNotMatch(
    renamedJournalDocumentTitle("climate_control", "Бланк контроля температуры и влажности на складах · Май 2026 г."),
    /на складах на складах/,
  );
  // Продолжение слова — не разделитель.
  assert.equal(
    renamedJournalDocumentTitle("climate_control", "Бланк контроля температуры и влажностиXYZ"),
    "Бланк контроля температуры и влажностиXYZ",
  );
});

test("поиск и «по алфавиту» — по новым названиям: «учет температур» находит оба журнала, «бланк» — ни один", async () => {
  const { journalMatchesQuery, normalizeJournalSearch } = await import("@/lib/journal-search");
  const { sortJournalsByName } = await import("@/lib/journal-sort");
  const found = (query: string) =>
    ACTIVE_JOURNAL_CATALOG.filter((item) => journalMatchesQuery([item.name, item.code], normalizeJournalSearch(query))).map(
      (item) => item.code,
    );
  assert.deepEqual(found("учет температур").sort(), ["climate_control", "cold_equipment_control"]);
  assert.deepEqual(found("журнал учёта температурного режима"), ["cold_equipment_control"]);
  assert.deepEqual(found("бланк"), []);
  // По алфавиту оба теперь среди «Журнал учёта…», а не в начале списка на «Б».
  const sorted = sortJournalsByName(ACTIVE_JOURNAL_CATALOG, (item) => item.name).map((item) => item.name);
  const climate = sorted.indexOf("Журнал учёта температуры и влажности на складах");
  const cold = sorted.indexOf("Журнал учёта температурного режима холодильного и морозильного оборудования");
  assert.ok(climate > 0 && cold > 0);
  assert.ok(sorted[climate - 1].localeCompare(sorted[climate], "ru") <= 0);
  assert.ok(sorted.slice(0, climate).every((name) => !name.startsWith("Чек") && !name.startsWith("Ш")));
  assert.equal(sorted.findIndex((name) => name.startsWith("Бланк")), -1);
});
