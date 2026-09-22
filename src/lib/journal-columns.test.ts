import assert from "node:assert/strict";
import test from "node:test";

import {
  JOURNAL_COLUMN_LABEL_MAX,
  applyColumnsToConfig,
  columnsConfigFromResolved,
  legacyFlagsFromColumns,
  moveColumn,
  parseOrgColumnDefaults,
  removeCustomColumn,
  resolveColumns,
  sanitizeColumnsConfig,
  syncColumnsWithLegacyFlags,
  visibleColumns,
  withOrgColumnDefault,
} from "@/lib/journal-columns";

const keys = (columns: Array<{ key: string }>) => columns.map((column) => column.key);

test("реестр: 15 колонок бракеража готовой продукции и 11 — скоропорта", () => {
  // Восемь колонок формы Приложения 4 + семь колонок расширенной формы.
  assert.equal(resolveColumns("finished_product", {}).length, 15);
  assert.equal(resolveColumns("perishable_rejection", {}).length, 11);
  assert.deepEqual(resolveColumns("hygiene", {}), []);
});

test("старый документ без columns: форма Приложения 4 + прежние видимые колонки (ничего не прячем)", () => {
  assert.deepEqual(keys(visibleColumns("finished_product", {})), [
    "production",
    "rejection",
    "name",
    "organoleptic",
    "release",
    "signatures",
    "portion",
    "note",
    "responsible",
    "inspector",
  ]);
  assert.ok(keys(visibleColumns("finished_product", { showProductTemp: true, showCourierTime: true })).includes("temp"));
  assert.ok(keys(visibleColumns("perishable_rejection", {})).includes("note"));
  assert.ok(!keys(visibleColumns("perishable_rejection", { showNote: false })).includes("note"));
});

test("приоритет: columns документа → общий вариант организации → флаги → реестр", () => {
  const doc = { showProductTemp: true, columns: { hidden: ["temp"], labels: {} } };
  assert.ok(!keys(visibleColumns("finished_product", doc)).includes("temp"));
  const org = { hidden: ["responsible"], labels: { name: "Блюдо" } };
  const withOrg = resolveColumns("finished_product", { showProductTemp: false }, org);
  assert.equal(withOrg.find((column) => column.key === "responsible")?.hidden, true);
  assert.equal(withOrg.find((column) => column.key === "name")?.label, "Блюдо");
  // В наборе перечислены скрытые колонки: «T°C» в нём нет — значит видна,
  // хотя старый флаг документа её выключал.
  assert.equal(withOrg.find((column) => column.key === "temp")?.hidden, false, "общий вариант важнее старого флага");
  const ownWins = resolveColumns("finished_product", { columns: { hidden: [], labels: {} } }, org);
  assert.equal(ownWins.find((column) => column.key === "responsible")?.hidden, false);
});

test("любую колонку можно скрыть, неизвестные ключи отбрасываются", () => {
  const sanitized = sanitizeColumnsConfig("perishable_rejection", {
    hidden: ["product", "note", "nope", "note"],
    labels: { nope: "x", product: "  Продукт  ", note: "" },
  });
  assert.deepEqual(sanitized, { hidden: ["product", "note"], labels: { product: "Продукт" } });
  assert.equal(sanitizeColumnsConfig("hygiene", { hidden: ["x"] }), null);
  assert.equal(sanitizeColumnsConfig("finished_product", "broken"), null);
});

test("подпись ограничена и не хранится, если совпадает со стандартной", () => {
  const long = "а".repeat(200);
  const sanitized = sanitizeColumnsConfig("finished_product", {
    hidden: [],
    labels: { organoleptic: long, release: "Разрешение к реализации блюда, кулинарного изделия" },
  });
  assert.equal(sanitized?.labels.organoleptic.length, JOURNAL_COLUMN_LABEL_MAX);
  assert.equal("release" in (sanitized?.labels ?? {}), false);
});

test("подписи зависят от режима документа", () => {
  const semi = resolveColumns("finished_product", { fieldNameMode: "semi", inspectorMode: "commission_signatures" });
  assert.equal(semi.find((column) => column.key === "name")?.label, "Наименование полуфабриката");
  assert.equal(semi.find((column) => column.key === "inspector")?.label, "Подписи членов комиссии");
});

test("legacyFlagsFromColumns ↔ columnsConfigFromResolved", () => {
  assert.deepEqual(legacyFlagsFromColumns("finished_product", { hidden: ["temp", "oxygen"], labels: {} }), {
    showProductTemp: false,
    showCorrectiveAction: true,
    showOxygenLevel: false,
    showReleaseAllowed: true,
    showCourierTime: true,
    showResponsible: true,
    showInspector: true,
  });
  assert.deepEqual(legacyFlagsFromColumns("perishable_rejection", { hidden: ["note"], labels: {} }), { showNote: false });

  const resolved = resolveColumns("finished_product", { columns: { hidden: ["courier"], labels: { name: "Блюдо" } } });
  assert.deepEqual(columnsConfigFromResolved(resolved), {
    // `release_allowed` заведена позже: у документа со старым набором
    // колонок флага в конфиге нет, поэтому она скрыта.
    hidden: ["temp", "corrective", "oxygen", "release_allowed", "courier"].filter(
      (key) => resolved.find((c) => c.key === key)?.hidden
    ),
    labels: { name: "Блюдо" },
    order: resolved.map((column) => column.key),
  });
});

test("колонка, заведённая позже: флаг главнее сохранённого набора колонок", () => {
  const key = "release_allowed";
  // Старый документ после нормализации: набор колонок без ключа и
  // флаг `false` — колонка не должна всплыть сама.
  const old = resolveColumns("finished_product", {
    columns: { hidden: ["responsible"], labels: {} },
    showReleaseAllowed: false,
  });
  assert.equal(old.find((column) => column.key === key)?.hidden, true);

  // Новый документ (и старый после включения колонки руками).
  const fresh = resolveColumns("finished_product", {
    columns: { hidden: ["responsible"], labels: {} },
    showReleaseAllowed: true,
  });
  assert.equal(fresh.find((column) => column.key === key)?.hidden, false);
});

test("общий набор организации: мусор и журналы без реестра отбрасываются", () => {
  const parsed = parseOrgColumnDefaults({
    finished_product: { hidden: ["temp", "name"], labels: { name: "Блюдо" } },
    hygiene: { hidden: ["x"] },
    perishable_rejection: "broken",
  });
  assert.deepEqual(parsed, { finished_product: { hidden: ["temp", "name"], labels: { name: "Блюдо" } } });
  assert.deepEqual(parseOrgColumnDefaults(null), {});
});

test("набор в конфиг документа: флаги showX синхронизируются", () => {
  const config = applyColumnsToConfig("finished_product", { rows: [], showProductTemp: true }, {
    hidden: ["temp", "responsible"],
    labels: {},
  });
  assert.equal(config.showProductTemp, false);
  assert.deepEqual((config.columns as { hidden: string[] }).hidden, ["temp", "responsible"]);
  assert.deepEqual(config.rows, []);
});

test("новый документ получает общий набор; свой набор документа не трогается", () => {
  const defaults = { perishable_rejection: { hidden: ["note"], labels: { product: "Продукт" } } };
  const created = withOrgColumnDefault("perishable_rejection", { showNote: true }, defaults) as Record<string, unknown>;
  assert.equal(created.showNote, false, "без respectFlags общий набор важнее флага по умолчанию");
  assert.deepEqual(created.columns, { hidden: ["note"], labels: { product: "Продукт" } });
  const own = { columns: { hidden: [], labels: {} } };
  assert.equal(withOrgColumnDefault("perishable_rejection", own, defaults), own);
  assert.equal(withOrgColumnDefault("finished_product", { rows: [] }, defaults)?.columns, undefined);
});

test("флаги из диалога создания важнее общего набора для своих колонок", () => {
  const defaults = { perishable_rejection: { hidden: ["note", "document"], labels: {} } };
  const created = withOrgColumnDefault("perishable_rejection", { showNote: true }, defaults, {
    respectFlags: true,
  }) as Record<string, unknown>;
  assert.equal(created.showNote, true);
  assert.deepEqual((created.columns as { hidden: string[] }).hidden, ["document"]);
});

test("настройки из списка документов: переключатель флага меняет набор колонок", () => {
  const synced = syncColumnsWithLegacyFlags("finished_product", {
    columns: { hidden: ["temp"], labels: { name: "Блюдо" } },
    showProductTemp: true,
    showCourierTime: false,
  });
  assert.deepEqual(synced.columns, { hidden: ["courier"], labels: { name: "Блюдо" } });
  const noColumns = { showProductTemp: true };
  assert.equal(syncColumnsWithLegacyFlags("finished_product", noColumns), noColumns);
});

const CUSTOM = {
  key: "custom:abc12345",
  label: "Партия",
  type: "select" as const,
  options: ["Первая", "Вторая"],
};

test("своя колонка резолвится после колонок бланка", () => {
  const resolved = resolveColumns("finished_product", { columns: { hidden: [], labels: {}, custom: [CUSTOM] } });
  const last = resolved[resolved.length - 1];
  assert.equal(last.key, CUSTOM.key);
  assert.equal(last.label, "Партия");
  assert.equal(last.custom?.type, "select");
  assert.deepEqual(last.custom?.options, ["Первая", "Вторая"]);
});

test("скрыть можно и свою колонку, и любую колонку бланка", () => {
  const resolved = resolveColumns("finished_product", {
    columns: { hidden: [CUSTOM.key, "name"], labels: {}, custom: [CUSTOM] },
  });
  assert.equal(resolved.find((c) => c.key === CUSTOM.key)?.hidden, true);
  assert.equal(resolved.find((c) => c.key === "name")?.hidden, true);
});

test("отметка «обязательно заполнять» доходит и до колонки бланка, и до своей", () => {
  const resolved = resolveColumns("finished_product", {
    columns: { hidden: [], labels: {}, custom: [CUSTOM], mustFill: ["temp", CUSTOM.key] },
  });
  assert.equal(resolved.find((c) => c.key === "temp")?.mustFill, true);
  assert.equal(resolved.find((c) => c.key === CUSTOM.key)?.mustFill, true);
  assert.equal(resolved.find((c) => c.key === "name")?.mustFill, false);
});

test("мусор в своих колонках отбрасывается, оценка зажимается в пределы", () => {
  const clean = sanitizeColumnsConfig("finished_product", {
    hidden: [],
    labels: {},
    custom: [
      { key: "bad-key", label: "Без префикса", type: "text" },
      { key: "custom:ok", label: "  Оценка  ", type: "rating", ratingMax: 99 },
      { key: "custom:ok", label: "Дубль ключа", type: "text" },
      { key: "custom:zzz", label: "", type: "text" },
      { key: "custom:typ", label: "Неизвестный тип", type: "wat" },
    ],
    mustFill: ["custom:ok", "нет такой колонки"],
  });
  assert.equal(clean?.custom?.length, 2);
  assert.equal(clean?.custom?.[0].key, "custom:ok");
  assert.equal(clean?.custom?.[0].label, "Оценка");
  assert.equal(clean?.custom?.[0].ratingMax, 10);
  assert.equal(clean?.custom?.[1].type, "text");
  assert.deepEqual(clean?.mustFill, ["custom:ok"]);
});

test("удаление своей колонки снимает её отметки", () => {
  const next = removeCustomColumn(
    { hidden: [CUSTOM.key], labels: {}, custom: [CUSTOM], mustFill: [CUSTOM.key] },
    CUSTOM.key,
  );
  assert.deepEqual(next.custom, []);
  assert.deepEqual(next.hidden, []);
  assert.deepEqual(next.mustFill, []);
});

test("конфиг из resolved сохраняет свои колонки и обязательность", () => {
  const resolved = resolveColumns("finished_product", {
    columns: { hidden: [], labels: {}, custom: [CUSTOM], mustFill: [CUSTOM.key] },
  });
  const back = columnsConfigFromResolved(resolved);
  assert.equal(back.custom?.length, 1);
  assert.deepEqual(back.mustFill, [CUSTOM.key]);
});

test("форма Приложения 4: подписи колонок как на бумажном бланке", () => {
  const labels = visibleColumns("finished_product", {
    showResponsible: false,
    showInspector: false,
  }).map((column) => column.label);
  assert.deepEqual(labels, [
    "Дата и час изготовления блюда",
    "Время снятия бракеража",
    "Наименование готового блюда",
    "Результаты органолептической оценки качества готовых блюд",
    "Разрешение к реализации блюда, кулинарного изделия",
    "Подпись бракеражной комиссии",
    "Результат взвешивания порционных блюд",
    "Примечание",
  ]);
});

test("порядок колонок: order из набора, остальные — по реестру", () => {
  const resolved = resolveColumns("finished_product", {
    columns: { hidden: [], labels: {}, order: ["note", "name", "nope"] },
  });
  assert.deepEqual(keys(resolved).slice(0, 3), ["note", "name", "production"]);
  const moved = moveColumn({ hidden: [], labels: {} }, resolveColumns("finished_product", {}), "rejection", -1);
  assert.deepEqual(moved.order?.slice(0, 2), ["rejection", "production"]);
});

test("скоропорт: колонки подписей комиссии нет — комиссия только у готовой продукции", () => {
  const keysOf = (config: Record<string, unknown>) => resolveColumns("perishable_rejection", config).map((column) => column.key);
  assert.equal(keysOf({}).includes("signatures"), false);
  // Даже у старого документа со скопированным составом комиссии.
  assert.equal(
    keysOf({ commissionMembers: [{ id: "c", role: "Председатель", employeeId: "u1", employeeName: "Иванова" }] }).includes("signatures"),
    false
  );
});
