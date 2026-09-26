/**
 * Тесты чистой части движка автозаполнения:
 *   - copy-forward walker (детерминизм, границы джиттера, skip-list,
 *     сохранение точности);
 *   - выбор источника copy-forward;
 *   - билдеры fryer/glass/ventilation + предикаты пустоты;
 *   - applyCleaningAutoSignatures (идемпотентность, ручные подписи).
 *
 * Запуск: npm test
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  COPY_FORWARD_SKIP_KEYS,
  applyPerDayJournalAutoFill,
  copyForwardWithJitter,
  countMatrixDiff,
  hashToUnit,
  pickCopyForwardCandidate,
} from "@/lib/journal-autofill";
import {
  buildFryerOilAutoFillEntryData,
  isFryerOilEntryDataEmpty,
  normalizeFryerOilDocumentConfig,
  normalizeFryerOilEntryData,
} from "@/lib/fryer-oil-document";
import { buildGlassControlAutoFillEntryData } from "@/lib/glass-control-document";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  type ClimateEntryData,
} from "@/lib/climate-document";
import {
  buildCleaningVentilationAutoFillEntryData,
  isCleaningVentilationEntryDataEmpty,
  normalizeCleaningVentilationConfig,
} from "@/lib/cleaning-ventilation-checklist-document";
import {
  CLEANING_SIGNATURE_ROW_ID,
  CONTROL_SIGNATURE_ROW_ID,
  applyCleaningAutoSignatures,
  markAutoSignature,
  normalizeCleaningDocumentConfig,
} from "@/lib/cleaning-document";

test("hashToUnit детерминирован и лежит в [0, 1)", () => {
  assert.equal(hashToUnit("seed"), hashToUnit("seed"));
  assert.notEqual(hashToUnit("seed-a"), hashToUnit("seed-b"));
  for (const seed of ["", "a", "2026-09-02:room:12:00"]) {
    const unit = hashToUnit(seed);
    assert.ok(unit >= 0 && unit < 1, seed);
  }
});

test("copyForwardWithJitter: jitterPct 0 — байт-в-байт без skip-ключей", () => {
  const source = {
    fatType: "Пальмовое масло",
    carryoverKg: 2.5,
    comment: "масло потемнело",
    nested: { qualityStart: 4, note: "вчерашний инцидент" },
  };
  const result = copyForwardWithJitter(source, "doc:2026-09-02");
  assert.deepEqual(result, {
    fatType: "Пальмовое масло",
    carryoverKg: 2.5,
    nested: { qualityStart: 4 },
  });
  // Источник не мутируется.
  assert.equal(source.comment, "масло потемнело");
});

test("copyForwardWithJitter: джиттер в пределах и с точностью источника", () => {
  const source = { temperature: 4.5, humidity: 60 };
  const first = copyForwardWithJitter(source, "seed", { jitterPct: 0.1 });
  const second = copyForwardWithJitter(source, "seed", { jitterPct: 0.1 });
  assert.deepEqual(first, second, "джиттер обязан быть детерминированным");

  const temperature = first.temperature as number;
  const humidity = first.humidity as number;
  assert.ok(Math.abs(temperature - 4.5) <= 4.5 * 0.1 + 1e-9);
  assert.ok(Math.abs(humidity - 60) <= 60 * 0.1 + 1e-9);
  // Точность источника сохраняется: 1 знак и целое соответственно.
  assert.equal(temperature, Math.round(temperature * 10) / 10);
  assert.equal(humidity, Math.round(humidity));
});

test("copyForwardWithJitter: overrides кладутся поверх результата", () => {
  const result = copyForwardWithJitter(
    { startDate: "2026-09-01", disposedKg: 3 },
    "seed",
    { overrides: { startDate: "2026-09-02", disposedKg: 0 } }
  );
  assert.equal(result.startDate, "2026-09-02");
  assert.equal(result.disposedKg, 0);
});

test("skip-list закрывает повторяющийся текст инцидентов", () => {
  for (const key of ["corrections", "measures", "comment", "note", "damageInfo", "_autoSeeded"]) {
    assert.ok(COPY_FORWARD_SKIP_KEYS.includes(key), key);
  }
});

test("фото замеров не переносятся на следующий день: вчерашний снимок — не доказательство сегодня", () => {
  const photo = `/uploads/readings/${"a1".repeat(16)}.jpg`;
  const copied = copyForwardWithJitter(
    { responsibleTitle: "Повар", temperatures: { fridge: 4 }, readingPhotos: { fridge: photo } },
    "doc:2026-09-27"
  );
  assert.equal("readingPhotos" in copied, false);
  assert.equal((copied.temperatures as Record<string, number>).fridge, 4);
  const climate = copyForwardWithJitter(
    { measurements: { r: { "10:00": { temperature: 18, humidity: 50 } } }, readingPhotos: { "r:10:00:temperature": photo } },
    "doc:2026-09-27"
  );
  assert.equal("readingPhotos" in climate, false);
});

test("pickCopyForwardCandidate пропускает болванки и пустые строки", () => {
  const filled = {
    startDate: "2026-09-01",
    fatType: "Подсолнечное масло",
    qualityStart: 5,
  };
  assert.equal(pickCopyForwardCandidate([]), null);
  assert.equal(
    pickCopyForwardCandidate([{ data: { _autoSeeded: true } }, { data: {} }]),
    null
  );
  const picked = pickCopyForwardCandidate([
    { data: { _autoSeeded: true } },
    { data: filled },
  ]);
  assert.equal(picked?.fatType, "Подсолнечное масло");
});

test("fryer: пустота строки и copy-forward билдера", () => {
  const config = normalizeFryerOilDocumentConfig({
    shift: { startTime: "08:00", endTime: "20:00" },
  });
  assert.equal(
    isFryerOilEntryDataEmpty(normalizeFryerOilEntryData({ _autoSeeded: true })),
    true
  );
  assert.equal(
    isFryerOilEntryDataEmpty(normalizeFryerOilEntryData({ fatType: "х" })),
    false
  );

  const source = normalizeFryerOilEntryData({
    startDate: "2026-09-01",
    fatType: "Пальмовое масло",
    equipmentType: "Фритюрница №2",
    productType: "Картофель фри",
    qualityStart: 4,
    qualityEnd: 4,
    carryoverKg: 1.5,
    disposedKg: 2,
    controllerName: "Иванова",
  });
  const built = buildFryerOilAutoFillEntryData({
    config,
    dateKey: "2026-09-02",
    source,
    controllerFallback: "Петров",
  });
  assert.equal(built.startDate, "2026-09-02");
  assert.equal(built.startHour, 8);
  assert.equal(built.endHour, 20);
  assert.equal(built.fatType, "Пальмовое масло");
  assert.equal(built.productType, "Картофель фри");
  assert.equal(built.carryoverKg, 1.5);
  // Утилизацию автозаполнение не выдумывает.
  assert.equal(built.disposedKg, 0);
  assert.equal(built.controllerName, "Иванова");
  assert.ok(built.qualityStartNote && !built.qualityStartNote.includes("утилизации"));

  const fromDefaults = buildFryerOilAutoFillEntryData({
    config,
    dateKey: "2026-09-02",
    source: null,
    controllerFallback: "Петров",
  });
  assert.equal(fromDefaults.fatType, "Подсолнечное масло");
  assert.equal(fromDefaults.qualityStart, 5);
  assert.equal(fromDefaults.controllerName, "Петров");
});

test("glass: автозапись — «повреждений не выявлено»", () => {
  assert.deepEqual(buildGlassControlAutoFillEntryData(), {
    damagesDetected: false,
    itemName: "",
    quantity: "",
    damageInfo: "",
  });
});

test("ventilation: билдер зеркалит включённые процедуры, пустота — без времён", () => {
  const users = [{ id: "u1", name: "Иванова", role: "manager" }];
  const config = normalizeCleaningVentilationConfig(
    { ventilationEnabled: false, mainResponsibleUserId: "u1" },
    users
  );
  const data = buildCleaningVentilationAutoFillEntryData(config);
  assert.equal(data.responsibleUserId, "u1");
  assert.ok((data.procedures.disinfection?.length ?? 0) > 0);
  assert.ok((data.procedures.wet_cleaning?.length ?? 0) > 0);
  assert.equal(data.procedures.ventilation, undefined);
  assert.equal(isCleaningVentilationEntryDataEmpty(data), false);
  assert.equal(isCleaningVentilationEntryDataEmpty({ procedures: {} }), true);
  assert.equal(
    isCleaningVentilationEntryDataEmpty({ procedures: { disinfection: [] } }),
    true
  );
});

function buildCleaningFixture(matrix: Record<string, Record<string, string>>) {
  return normalizeCleaningDocumentConfig({
    rooms: [{ id: "room-1", name: "Горячий цех" }],
    cleaningResponsibles: [
      { id: "c-1", title: "Уборщица", userId: "u1", userName: "Маркова", code: "С1" },
    ],
    controlResponsibles: [
      { id: "k-1", title: "Заведующая", userId: "u2", userName: "Иванова", code: "С1" },
    ],
    matrix,
  });
}

test("applyCleaningAutoSignatures ставит auto-подписи по дням с Т/Г", () => {
  const config = buildCleaningFixture({
    "room-1": { "2026-09-01": "T", "2026-09-02": "/" },
  });
  // Коды нормализуются самим конфигом (reindexResponsibles), поэтому
  // ожидание берём из него же, а не из литерала: иначе тест ловит
  // раскладку буквы «C», а не поведение подписей.
  // Подпись хранит стабильную ссылку на сотрудника, а не код «СN».
  const cleaningCode = `uid:${config.cleaningResponsibles[0].userId}`;
  const controlCode = `uid:${config.controlResponsibles[0].userId}`;
  const next = applyCleaningAutoSignatures(config, ["2026-09-01", "2026-09-02"]);
  assert.equal(
    next.matrix[CLEANING_SIGNATURE_ROW_ID]?.["2026-09-01"],
    markAutoSignature(cleaningCode)
  );
  assert.equal(next.matrix[CLEANING_SIGNATURE_ROW_ID]?.["2026-09-02"], undefined);
  assert.equal(
    next.matrix[CONTROL_SIGNATURE_ROW_ID]?.["2026-09-01"],
    markAutoSignature(controlCode)
  );

  // Идемпотентность: повторный вызов возвращает config как есть.
  const again = applyCleaningAutoSignatures(next, ["2026-09-01", "2026-09-02"]);
  assert.equal(again, next);
});

test("applyCleaningAutoSignatures не трогает ручные подписи и снимает устаревшие auto", () => {
  const config = buildCleaningFixture({
    "room-1": { "2026-09-02": "/" },
    [CLEANING_SIGNATURE_ROW_ID]: {
      "2026-09-01": "С1", // ручная — остаётся, хотя день пуст
      "2026-09-02": markAutoSignature("С1"), // auto при пустом дне — снимается
    },
  });
  const next = applyCleaningAutoSignatures(config, ["2026-09-01", "2026-09-02"]);
  assert.equal(next.matrix[CLEANING_SIGNATURE_ROW_ID]?.["2026-09-01"], "С1");
  assert.equal(next.matrix[CLEANING_SIGNATURE_ROW_ID]?.["2026-09-02"], undefined);
});

test("applyCleaningAutoSignatures пропускает дни с TF-completions", () => {
  const config = buildCleaningFixture({
    "room-1": { "2026-09-01": "T" },
  });
  const next = applyCleaningAutoSignatures(config, ["2026-09-01"], {
    completionDays: new Set(["2026-09-01"]),
  });
  assert.equal(next.matrix[CLEANING_SIGNATURE_ROW_ID], undefined);
});

test("countMatrixDiff считает изменённые ячейки", () => {
  assert.equal(countMatrixDiff({}, {}), 0);
  assert.equal(
    countMatrixDiff(
      { "room-1": { "2026-09-01": "T" } },
      { "room-1": { "2026-09-01": "T" } }
    ),
    0
  );
  assert.equal(
    countMatrixDiff(
      { "room-1": { "2026-09-01": "" } },
      { "room-1": { "2026-09-01": "T", "2026-09-02": "/" }, "room-2": { "2026-09-01": "G" } }
    ),
    3
  );
});

// ---------------------------------------------------------------------------
// «Закрыть день»: перенос замеров с последнего заполнения и зажим в нормы
// ---------------------------------------------------------------------------

test("clampClimateToNorms: значение вне нормы прижимается к границе", async () => {
  const { clampClimateToNorms } = await import("@/lib/journal-autofill");
  const { normalizeClimateDocumentConfig, normalizeClimateEntryData } = await import(
    "@/lib/climate-document"
  );
  const config = normalizeClimateDocumentConfig({
    rooms: [
      {
        id: "r1",
        name: "Цех",
        temperature: { enabled: true, min: 18, max: 25 },
        humidity: { enabled: true, min: 15, max: 75 },
      },
    ],
    controlTimes: ["10:00"],
  });
  const data = normalizeClimateEntryData({
    responsibleTitle: null,
    measurements: { r1: { "10:00": { temperature: 27.3, humidity: 10 } } },
  });
  const clamped = clampClimateToNorms(data, config);
  assert.equal(clamped.measurements.r1["10:00"].temperature, 25);
  assert.equal(clamped.measurements.r1["10:00"].humidity, 15);
});

test("clampColdEquipmentToNorms: null-границы не мешают, число зажимается", async () => {
  const { clampColdEquipmentToNorms } = await import("@/lib/journal-autofill");
  const { normalizeColdEquipmentDocumentConfig, normalizeColdEquipmentEntryData } =
    await import("@/lib/cold-equipment-document");
  const config = normalizeColdEquipmentDocumentConfig({
    equipment: [
      { id: "f1", name: "Холодильник", min: 2, max: 6 },
      { id: "f2", name: "Морозилка", min: null, max: -18 },
    ],
  });
  const data = normalizeColdEquipmentEntryData({
    responsibleTitle: null,
    temperatures: { f1: 8.4, f2: -25 },
  });
  const clamped = clampColdEquipmentToNorms(data, config);
  assert.equal(clamped.temperatures.f1, 6);
  assert.equal(clamped.temperatures.f2, -25);
});

test("copyForwardWithJitter с 2% не выносит замер далеко от источника", () => {
  const out = copyForwardWithJitter({ t: 20.0, h: 50 }, "doc:2026-09-04", {
    jitterPct: 0.02,
  });
  assert.ok(Math.abs((out.t as number) - 20) <= 0.4 + 1e-9);
  assert.ok(Math.abs((out.h as number) - 50) <= 1 + 1e-9);
});

/**
 * Микроклимат, баг со скриншота: автозаполнение выбирает одну строку на
 * дату (чья бы ни была) и раньше дописывало в неё должность ответственного
 * документа — под фамилией другого сотрудника появлялось «Заведующий
 * производством». Замеры по-прежнему дописываются, должность — нет.
 */
function fakeClimateDb(rowEmployeeId: string) {
  const updates: Array<{ where: { id: string }; data: { data: unknown } }> = [];
  const creates: unknown[] = [];
  const db = {
    journalDocumentEntry: {
      findMany: async () => [
        {
          id: "e1",
          employeeId: rowEmployeeId,
          date: new Date("2026-09-02T00:00:00.000Z"),
          data: {
            responsibleTitle: null,
            measurements: { r1: { "10:00": { temperature: 19.4, humidity: null } } },
          },
        },
      ],
      createMany: async (args: unknown) => {
        creates.push(args);
        return { count: 1 };
      },
      update: async (args: (typeof updates)[number]) => {
        updates.push(args);
        return {};
      },
    },
  } as unknown as Parameters<typeof applyPerDayJournalAutoFill>[0];
  return { db, updates, creates };
}

const climateDocument = {
  id: "doc",
  organizationId: "org",
  templateCode: CLIMATE_DOCUMENT_TEMPLATE_CODE,
  config: {
    rooms: [
      {
        id: "r1",
        name: "Склад",
        temperature: { enabled: true, min: 18, max: 25 },
        humidity: { enabled: true, min: 40, max: 75 },
      },
    ],
    controlTimes: ["10:00"],
  },
  responsibleUserId: "resp",
  responsibleTitle: "Заведующий производством",
  dateFrom: new Date("2026-09-01T00:00:00.000Z"),
  dateTo: new Date("2026-09-30T00:00:00.000Z"),
};

test("климат: автозаполнение не пишет должность документа в строку другого сотрудника", async () => {
  const { db, updates, creates } = fakeClimateDb("akulinina");
  const result = await applyPerDayJournalAutoFill(db, {
    document: climateDocument,
    dateKeys: ["2026-09-02"],
  });
  assert.equal(creates.length, 0);
  assert.equal(result.updated, 1);
  const written = updates[0].data.data as ClimateEntryData;
  assert.equal(written.responsibleTitle, null);
  assert.equal(written.measurements.r1["10:00"].temperature, 19.4);
  assert.notEqual(written.measurements.r1["10:00"].humidity, null);
});

test("климат: строка самого ответственного по-прежнему получает его должность", async () => {
  const { db, updates } = fakeClimateDb("resp");
  await applyPerDayJournalAutoFill(db, { document: climateDocument, dateKeys: ["2026-09-02"] });
  const written = updates[0].data.data as ClimateEntryData;
  assert.equal(written.responsibleTitle, "Заведующий производством");
});
