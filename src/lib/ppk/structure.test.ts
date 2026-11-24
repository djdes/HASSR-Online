import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PPK_STRUCTURE,
  PPK_STRUCTURE_ITEMS,
  ppkItemForBlock,
  ppkItemHref,
  ppkStructureItem,
} from "./structure";
import { PPK_FOLDERS, isPpkFolder } from "./folders";
import { PPK_RECORD_BLOCKS, PPK_RECORD_LIMITS, PPK_RECORD_SCHEMAS, PPK_SINGLETON_BLOCKS, PPK_TEXT_BLOCKS } from "./records";
import { PRP_TABLES, PRP_TABLE_BLOCKS, emptyPrpRow } from "./prp-tables";
import {
  PRP_TEMPLATES,
  ccpMethodTemplate,
  haccpPrinciplesTemplate,
  ppkTextTemplate,
  teamLeaderRegulationTemplate,
  teamRegulationTemplate,
} from "./structure-templates";
import { EMERGENCIES } from "./program-content";
import { PPK_BLOCKS } from "./registry";

test("структура повторяет документ: 9 + 10 + 7 пунктов и 6 приложений", () => {
  assert.deepEqual(
    PPK_STRUCTURE.map((section) => [section.key, section.number, section.items.length]),
    [
      ["primary", "1", 9],
      ["plan", "2", 10],
      ["prp", "3", 7],
      ["appendix", null, 6],
    ],
  );
  assert.equal(PPK_STRUCTURE_ITEMS.length, 32);
  assert.deepEqual(
    PPK_STRUCTURE[0].items.map((item) => item.number),
    ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9"],
  );
  assert.deepEqual(
    PPK_STRUCTURE[1].items.map((item) => item.number),
    ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10"],
  );
  assert.deepEqual(PPK_STRUCTURE[2].items.map((item) => item.number), ["3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7"]);
  assert.deepEqual(PPK_STRUCTURE[3].items.map((item) => item.number), ["1", "2", "3", "4", "5", "6"]);
});

test("id пункта уникален и без точек — это часть адреса", () => {
  const ids = PPK_STRUCTURE_ITEMS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^(?:\d-\d{1,2}|app-\d)$/, id);
  assert.equal(ppkItemHref("2-10"), "/production-control/item/2-10");
  assert.equal(ppkStructureItem("1-1")?.panel, "org-info");
  assert.equal(ppkStructureItem("1.1"), null);
  assert.equal(ppkStructureItem(null), null);
  assert.equal(ppkStructureItem("app-3")?.scanFolder, "flow-schedule");
});

test("пункты ссылаются только на существующие блоки, папки, тексты и таблицы", () => {
  const blockKeys = new Set(PPK_BLOCKS.map((block) => block.key));
  for (const item of PPK_STRUCTURE_ITEMS) {
    if (item.block) assert.ok(blockKeys.has(item.block), `${item.id}: ${item.block}`);
    if (item.scanFolder) assert.ok(isPpkFolder(item.scanFolder), `${item.id}: ${item.scanFolder}`);
    if (item.legacyFolder) assert.ok(isPpkFolder(item.legacyFolder), `${item.id}: ${item.legacyFolder}`);
    if (item.text) assert.ok((PPK_TEXT_BLOCKS as readonly string[]).includes(item.text.block), item.id);
    if (item.table) assert.ok((PRP_TABLE_BLOCKS as readonly string[]).includes(item.table), item.id);
    if (item.panel === "text") assert.ok(item.text, `${item.id}: текстовый пункт без записи`);
    if (item.panel === "prp-table") assert.ok(item.table, `${item.id}: таблица без блока`);
  }
  // Каждый текст и каждая таблица — ровно в одном пункте.
  const texts = PPK_STRUCTURE_ITEMS.flatMap((item) => (item.text ? [item.text.block] : []));
  assert.deepEqual([...texts].sort(), [...PPK_TEXT_BLOCKS].sort());
  const tables = PPK_STRUCTURE_ITEMS.flatMap((item) => (item.table ? [item.table] : []));
  assert.deepEqual([...tables].sort(), [...PRP_TABLE_BLOCKS].sort());
  assert.equal(ppkItemForBlock("hazards")?.id, "2-6");
  assert.equal(ppkItemForBlock("lab")?.id, "3-6");
});

test("документ без источника — пустые окна: 1.9 и приложение № 3 без шаблона", () => {
  assert.equal(ppkStructureItem("1-9")?.text?.template, null);
  assert.equal(ppkStructureItem("app-3")?.text?.template, null);
  assert.equal(ppkTextTemplate(null, "Кафе"), "");
});

test("новые блоки реестра: одиночные тексты и сведения, лимиты, папки", () => {
  for (const block of [
    "org-chart",
    "contracts",
    "production-info",
    ...PPK_TEXT_BLOCKS,
    ...PRP_TABLE_BLOCKS,
  ] as const) {
    assert.ok(PPK_RECORD_BLOCKS.includes(block), block);
  }
  for (const block of PPK_TEXT_BLOCKS) {
    assert.equal(PPK_RECORD_LIMITS[block], 1);
    assert.ok((PPK_SINGLETON_BLOCKS as readonly string[]).includes(block));
  }
  assert.equal(PPK_RECORD_LIMITS["production-info"], 1);
  assert.ok((PPK_SINGLETON_BLOCKS as readonly string[]).includes("production-info"));
  for (const folder of ["contracts", "policy-scan", "team-regulation-scan", "team-leader-scan", "team-order-scan", "flow-schedule"]) {
    assert.ok((PPK_FOLDERS as readonly string[]).includes(folder), folder);
  }
});

test("договор: наименование обязательно, даты — YYYY-MM-DD, флаг проверяющего — булев", () => {
  const schema = PPK_RECORD_SCHEMAS.contracts;
  const good = { title: "Договор на вывоз ТКО", counterparty: "ООО «Эко»", number: "12/24", date: "2024-03-01", validUntil: null, visibleToInspector: true };
  assert.equal(schema.safeParse(good).success, true);
  assert.equal(schema.safeParse({ ...good, title: "  " }).success, false);
  assert.equal(schema.safeParse({ ...good, date: "01.03.2024" }).success, false);
  assert.equal(schema.safeParse({ ...good, visibleToInspector: "да" }).success, false);
});

test("тексты и сведения о производстве проходят схему, лишнее режется пределом", () => {
  assert.equal(PPK_RECORD_SCHEMAS["text-terms"].safeParse({ text: "" }).success, true);
  assert.equal(PPK_RECORD_SCHEMAS["text-terms"].safeParse({ text: "x".repeat(30001) }).success, false);
  const info = Object.fromEntries(
    ["activity", "workingHours", "seats", "capacity", "area", "waterSupply", "sewage", "ventilation", "heating", "serviceForm", "extra"].map((key) => [key, ""]),
  );
  assert.equal(PPK_RECORD_SCHEMAS["production-info"].safeParse(info).success, true);
  assert.equal(PPK_RECORD_SCHEMAS["production-info"].safeParse({ ...info, workingHours: "x".repeat(201) }).success, false);
});

test("оргструктура — схема блок-схемы: связи только между блоками схемы", () => {
  const schema = PPK_RECORD_SCHEMAS["org-chart"];
  const node = (id: string) => ({ id, x: 40, y: 40, w: 200, h: 64, label: id, kind: "step", ccp: null, areaId: null });
  assert.equal(
    schema.safeParse({ title: "Оргструктура", nodes: [node("a"), node("b")], edges: [{ id: "e", from: "a", to: "b", points: [], flow: null, label: "" }] }).success,
    true,
  );
  assert.equal(
    schema.safeParse({ title: "", nodes: [node("a")], edges: [{ id: "e", from: "a", to: "zzz", points: [], flow: null, label: "" }] }).success,
    false,
  );
});

test("строка таблицы ПОПМ: первая колонка обязательна, пустая строка не проходит", () => {
  for (const block of PRP_TABLE_BLOCKS) {
    const schema = PPK_RECORD_SCHEMAS[block];
    assert.equal(schema.safeParse(emptyPrpRow(block)).success, false, block);
    const first = PRP_TABLES[block][0];
    assert.equal(first.required, true, block);
    assert.equal(schema.safeParse({ ...emptyPrpRow(block), [first.key]: "Строка" }).success, true, block);
  }
});

test("типовые строки таблиц проходят схему записи и укладываются в лимит", () => {
  for (const block of PRP_TABLE_BLOCKS) {
    const rows = PRP_TEMPLATES[block];
    assert.ok(rows.length > 0, block);
    assert.ok(rows.length <= PPK_RECORD_LIMITS[block], block);
    for (const row of rows) {
      const parsed = PPK_RECORD_SCHEMAS[block].safeParse(row);
      assert.equal(parsed.success, true, `${block}: ${JSON.stringify(row).slice(0, 80)}`);
    }
  }
  // Аварийные ситуации — тот же перечень, что программа печатает по умолчанию.
  assert.deepEqual(
    PRP_TEMPLATES["prp-emergencies"].map((row) => row.situation),
    EMERGENCIES.map((item) => item.title),
  );
});

test("шаблоны текстов: с названием организации, проходят схему текста", () => {
  const schema = PPK_RECORD_SCHEMAS["text-haccp-principles"];
  for (const text of [
    haccpPrinciplesTemplate("ООО «Ромашка»"),
    teamLeaderRegulationTemplate("ООО «Ромашка»"),
    ccpMethodTemplate("ООО «Ромашка»"),
    teamRegulationTemplate("ООО «Ромашка»"),
  ]) {
    assert.ok(text.includes("ООО «Ромашка»"), text.slice(0, 60));
    assert.equal(schema.safeParse({ text }).success, true);
  }
  assert.equal((haccpPrinciplesTemplate("Кафе").match(/Принцип \d\./g) ?? []).length, 7);
  // Методика повторяет дерево решений блока ККТ: четыре вопроса.
  assert.equal((ccpMethodTemplate("Кафе").match(/^В\d\./gm) ?? []).length, 4);
  assert.ok(teamRegulationTemplate("").startsWith("1. Общие положения"));
  assert.equal(ppkTextTemplate("team-leader", "Кафе"), teamLeaderRegulationTemplate("Кафе"));
});

test("загрузка из справочника: только готовая продукция и полуфабрикаты, без дублей, в пределах места", async () => {
  const { productsFromDirectory } = await import("./product-import");
  const directory = [
    { name: "Борщ", kind: "finished", storageTemp: "+2…+6 °C", storageConditions: null, shelfLifeDays: null, shelfLifeHours: 24 },
    { name: "Котлета п/ф", kind: "semi", storageTemp: null, storageConditions: "в закрытой таре", shelfLifeDays: 2, shelfLifeHours: null },
    { name: "Мука", kind: "raw", storageTemp: null, storageConditions: null, shelfLifeDays: 180, shelfLifeHours: null },
    { name: "борщ ", kind: "finished", storageTemp: null, storageConditions: null, shelfLifeDays: null, shelfLifeHours: null },
    { name: "Салат", kind: "finished", storageTemp: null, storageConditions: null, shelfLifeDays: null, shelfLifeHours: null },
  ];
  const items = productsFromDirectory(directory, ["САЛАТ"], 10);
  assert.deepEqual(items.map((item) => [item.name, item.category, item.storage, item.shelfLife]), [
    ["Борщ", "ready-meals", "+2…+6 °C", "24 ч"],
    ["Котлета п/ф", "semi-finished", "в закрытой таре", "2 сут."],
  ]);
  for (const item of items) assert.equal(PPK_RECORD_SCHEMAS.products.safeParse(item).success, true);
  assert.equal(productsFromDirectory(directory, [], 1).length, 1);
  assert.equal(productsFromDirectory(directory, [], 0).length, 0);
});

test("у каждого пункта и каждой колонки таблиц есть подписи во всех словарях", async () => {
  const { readFileSync } = await import("node:fs");
  for (const lang of ["ru", "en", "uz"]) {
    const messages = JSON.parse(readFileSync(`src/i18n/messages/${lang}.json`, "utf8"));
    const structure = messages.productionControl.structure;
    for (const item of PPK_STRUCTURE_ITEMS) {
      assert.ok(structure.items[item.id]?.title, `${lang}: ${item.id}.title`);
      assert.ok(structure.items[item.id]?.source, `${lang}: ${item.id}.source`);
    }
    for (const section of PPK_STRUCTURE) assert.ok(structure.sections[section.key], `${lang}: ${section.key}`);
    for (const block of PRP_TABLE_BLOCKS) {
      assert.ok(structure.prp.notes[block], `${lang}: notes.${block}`);
      for (const column of PRP_TABLES[block]) {
        assert.ok(structure.prp.columns[block]?.[column.key], `${lang}: columns.${block}.${column.key}`);
      }
    }
  }
  // Названия пунктов по-русски — дословно из документа владельца.
  const ru = JSON.parse(readFileSync("src/i18n/messages/ru.json", "utf8")).productionControl.structure;
  assert.equal(ru.items["1-1"].title, "Общая информация об организации");
  assert.equal(ru.items["2-9"].title, "Методика определения ККТ и точек применения ППОПМ");
  assert.equal(ru.items["app-4"].title, "Перечень журналов по системе ХАССП");
  assert.equal(ru.sections.prp, "Программы обязательных предварительных мероприятий (ПОПМ)");
});

test("шаблон положения о группе 2.2 дополняется составом группы", () => {
  const text = teamRegulationTemplate("Кафе", [
    { name: "Иванова Анна", title: "Шеф-повар", role: "leader" },
    { name: "Петров Олег", title: "", role: "member" },
  ]);
  assert.match(text, /6\. Состав группы ХАССП\n1\) Иванова Анна, шеф-повар — руководитель группы;\n2\) Петров Олег — член группы\./);
  assert.ok(!teamRegulationTemplate("Кафе").includes("Состав группы ХАССП"), "без группы — без раздела");
  assert.equal(PPK_RECORD_SCHEMAS["text-team-regulation"].safeParse({ text }).success, true);
});

test("в составе группы аббревиатуры в должности не ломаются", () => {
  const text = teamRegulationTemplate("Кафе", [{ name: "Сидоров Иван", title: "Координатор ХАССП", role: "secretary" }]);
  assert.ok(text.includes("1) Сидоров Иван, координатор ХАССП — секретарь группы."), text.slice(-80));
});
