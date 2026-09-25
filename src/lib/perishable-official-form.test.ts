import assert from "node:assert/strict";
import test from "node:test";

import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { builtInTemplates, columnsFromHeaderLabels } from "@/lib/journal-column-templates";
import {
  parseOrgColumnDefaults,
  resolveColumns,
  sanitizeColumnsConfig,
  upgradeSavedColumns,
  visibleColumns,
} from "@/lib/journal-columns";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import {
  normalizePerishableRejectionConfig,
  perishableCellText,
  perishableLegacySignatureLines,
  perishablePrintColumns,
  withoutGluedTail,
} from "@/lib/perishable-rejection-document";

/**
 * Графы рекомендуемого образца «Журнал бракеража скоропортящейся пищевой
 * продукции» — приложение № 5 к СанПиН 2.3/2.4.3590-20 (и к СанПиН
 * 2.3/2.4.4282-26), дословно и по порядку; источник и цитата —
 * .agent/tasks/perishable-official-form-2026-09/evidence.md. Первая буква —
 * заглавная (в образце графы 4–8 начинаются со строчной).
 */
const APPENDIX5 = [
  "Дата и час, поступления пищевой продукции",
  "Наименование",
  "Фасовка",
  "Дата выработки",
  "Изготовитель",
  "Поставщик",
  "Количество поступившего продукта (в кг, литрах, шт)",
  "Номер документа, подтверждающего безопасность принятого пищевого продукта (декларация о соответствии, свидетельство о государственной регистрации, документы по результатам ветеринарно-санитарной экспертизы)",
  "Результаты органолептической оценки, поступившего продовольственного сырья и пищевых продуктов",
  "Условия хранения, конечный срок реализации",
  "Дата и час фактической реализации",
  "Подпись ответственного лица",
  "Примечание",
];
const APPENDIX5_KEYS = [
  "arrival",
  "product",
  "packaging",
  "productionDate",
  "manufacturer",
  "supplier",
  "quantity",
  "document",
  "organoleptic",
  "storage",
  "sale",
  "responsible",
  "note",
];
const OLD_ORDER = ["arrival", "product", "productionDate", "manufacturer", "packaging", "document", "organoleptic", "storage", "sale", "responsible", "note"];

const labels = (config: unknown) => visibleColumns("perishable_rejection", config).map((column) => column.label);
const keys = (config: unknown) => visibleColumns("perishable_rejection", config).map((column) => column.key);

test("«Стандартная форма (Приложение №5 СанПиН)» — ровно 13 граф образца, дословно и по порядку", () => {
  const template = builtInTemplates("perishable_rejection").find((item) => item.id === "builtin:standard");
  assert.ok(template);
  assert.equal(template.name, "Стандартная форма (Приложение №5 СанПиН)");
  assert.deepEqual(labels({ columns: template.columns }), APPENDIX5);
  assert.deepEqual(keys({ columns: template.columns }), APPENDIX5_KEYS);
});

test("старый документ без набора колонок открывается формой приложения № 5; «Примечание» — по старому флагу", () => {
  assert.deepEqual(labels({}), APPENDIX5);
  assert.deepEqual(labels({ showNote: true }), APPENDIX5);
  assert.deepEqual(labels({ showNote: false }), APPENDIX5.slice(0, 12));
});

test("старый набор «Стандартная форма» (прежний порядок, 11 граф) → форма приложения № 5", () => {
  assert.deepEqual(labels({ columns: { hidden: [], labels: {}, order: OLD_ORDER } }), APPENDIX5);
  // Свои колонки остаются за той графой бланка, за которой стояли.
  const withCustom = {
    columns: {
      hidden: [],
      labels: {},
      custom: [{ key: "custom:t", label: "Т °C", type: "number" }],
      order: [...OLD_ORDER.slice(0, 4), "custom:t", ...OLD_ORDER.slice(4)],
    },
  };
  const got = keys(withCustom);
  assert.deepEqual(got.filter((key) => key !== "custom:t"), APPENDIX5_KEYS);
  assert.equal(got[got.indexOf("manufacturer") + 1], "custom:t");
});

test("свой набор организации: новые графы — рядом с прежней склеенной, видимость и «обязательно» — от неё", () => {
  const own = {
    hidden: ["document", "packaging"],
    labels: { product: "Продукт" },
    mustFill: ["manufacturer"],
    custom: [{ key: "custom:t1", label: "Т °C при приёмке", type: "number" }],
    order: ["product", "arrival", "manufacturer", "packaging", "custom:t1", "productionDate", "document", "organoleptic", "storage", "sale", "responsible", "note"],
  };
  const sanitized = sanitizeColumnsConfig("perishable_rejection", own);
  assert.ok(sanitized);
  assert.deepEqual(sanitized.order, [
    "product",
    "arrival",
    "manufacturer",
    "supplier",
    "packaging",
    "quantity",
    "custom:t1",
    "productionDate",
    "document",
    "organoleptic",
    "storage",
    "sale",
    "responsible",
    "note",
  ]);
  assert.deepEqual(sanitized.hidden, ["document", "packaging", "quantity"], "количество было в скрытой «Фасовка/Кол-во»");
  assert.deepEqual(sanitized.mustFill, ["manufacturer", "supplier"]);
  assert.deepEqual(sanitized.labels, { product: "Продукт" }, "свои подписи не трогаем");
  // Повторная очистка ничего не меняет: набор уже знает новые графы.
  assert.deepEqual(sanitizeColumnsConfig("perishable_rejection", sanitized), sanitized);
  assert.equal(labels({ columns: sanitized })[0], "Продукт");
});

test("скрытая «Изготовитель/поставщик» в старом наборе без порядка прячет и «Поставщик»", () => {
  const upgraded = upgradeSavedColumns("perishable_rejection", { hidden: ["manufacturer"], labels: {} });
  assert.deepEqual(upgraded.hidden, ["manufacturer", "supplier"]);
  assert.equal(upgraded.order, undefined, "порядка не было — остаётся порядок реестра");
  // Набор без упоминания новых граф и без скрытых «родителей» не меняется.
  const plain = { hidden: ["note"], labels: {} };
  assert.equal(upgradeSavedColumns("perishable_rejection", plain), plain);
  // Новый набор, где графы уже есть, не трогаем.
  const fresh = { hidden: ["manufacturer"], labels: {}, order: APPENDIX5_KEYS };
  assert.equal(upgradeSavedColumns("perishable_rejection", fresh), fresh);
  // У бракеража готовой продукции смен реестра нет.
  const finished = { hidden: ["temp"], labels: {} };
  assert.equal(upgradeSavedColumns("finished_product", finished), finished);
});

test("общий набор организации и свой шаблон из базы читаются по новой форме", () => {
  const parsed = parseOrgColumnDefaults({ perishable_rejection: { hidden: [], labels: {}, order: OLD_ORDER } });
  assert.deepEqual(parsed.perishable_rejection?.order, APPENDIX5_KEYS);
  const doc = resolveColumns("perishable_rejection", { rows: [] }, { hidden: [], labels: {}, order: OLD_ORDER });
  assert.deepEqual(
    doc.filter((column) => !column.hidden).map((column) => column.label),
    APPENDIX5
  );
});

test("импорт типовой формы из Excel: шапка образца узнаётся целиком, без своих колонок и обрезанных подписей", () => {
  const preview = columnsFromHeaderLabels("perishable_rejection", APPENDIX5);
  assert.deepEqual(preview.matched.map((item) => item.key), APPENDIX5_KEYS);
  assert.deepEqual(preview.custom, []);
  assert.deepEqual(preview.columns.labels, {});
  assert.deepEqual(labels({ columns: preview.columns }), APPENDIX5);
  // Старая склеенная шапка по-прежнему узнаётся.
  const old = columnsFromHeaderLabels("perishable_rejection", ["Изготовитель/поставщик", "Фасовка/Кол-во поступившего продукта"]);
  assert.deepEqual(old.matched.map((item) => item.key), ["manufacturer", "packaging"]);
});

/** Строки, как они лежат в базе у старых документов. */
const LEGACY_ROWS = [
  {
    // По QR: форма телефона пишет только поставщика и количество.
    id: "qr",
    arrivalDate: "2026-09-25",
    arrivalTime: "09:30",
    productName: "Молоко 3,2 %",
    supplier: "ООО «Молочник»",
    quantity: "20 л",
    organolepticResult: "good_quality",
    storageCondition: "2_6",
    responsiblePerson: "Иван Петров, Повар",
    note: "упаковка целая",
    sourceRowKey: "employee-u1#qr-1",
  },
  {
    // Прежняя правка ячейки на месте: вся склейка в одном поле.
    id: "glued",
    arrivalDate: "2026-09-25",
    arrivalTime: "10:20",
    productName: "Творог 9 %",
    productionDate: "2026-09-24",
    manufacturer: "ООО «Ополье» / ИП Смирнов А. В. / ИП Смирнов А. В.",
    supplier: "ИП Смирнов А. В.",
    packaging: "Пакет 1 кг / 6 шт.",
    quantity: "6 шт.",
    expiryDate: "2026-10-01",
    expiryTime: "10:00",
  },
  {
    // Совсем старая строка: ключей supplier / quantity / note нет, фасовка
    // с количеством — одной строкой.
    id: "old",
    arrivalDate: "2026-09-20",
    arrivalTime: "07:15",
    productName: "Куриное филе охл.",
    manufacturer: "ЗАО «Петелинская птицефабрика»",
    packaging: "Лоток, 12 кг",
    documentNumber: "ВСД 1234567890",
    organolepticResult: "compliant",
    storageCondition: "minus2_2",
    expiryDate: "2026-09-24",
    responsiblePerson: "Мария Смирнова, Управляющий",
  },
  {
    id: "signed",
    arrivalDate: "2026-09-21",
    arrivalTime: "11:05",
    productName: "Салат листовой",
    manufacturer: "ООО «Агропродукт»",
    supplier: "ООО «Агропродукт»",
    signatures: [
      { userId: "u2", name: "Мария Смирнова", role: "Председатель комиссии", signedAt: "2026-09-21T08:40:00.000Z", method: "qr" },
    ],
  },
];

test("старые записи в новых графах: ничего не теряется, склейка не повторяется, без миграции", () => {
  const config = normalizePerishableRejectionConfig({ rows: LEGACY_ROWS });
  const [qr, glued, old, signed] = config.rows;
  const row = (r: (typeof config.rows)[number]) => Object.fromEntries(APPENDIX5_KEYS.map((key) => [key, perishableCellText(r, key)]));

  assert.deepEqual(row(qr), {
    arrival: "25.09.2026 09:30",
    product: "Молоко 3,2 %",
    packaging: "",
    productionDate: "",
    manufacturer: "",
    supplier: "ООО «Молочник»",
    quantity: "20 л",
    document: "",
    organoleptic: "Доброкачественно",
    storage: "+2°С до +6°С",
    sale: "",
    responsible: "Иван Петров, Повар",
    note: "упаковка целая",
  });
  assert.equal(perishableCellText(glued, "manufacturer"), "ООО «Ополье»");
  assert.equal(perishableCellText(glued, "supplier"), "ИП Смирнов А. В.");
  assert.equal(perishableCellText(glued, "packaging"), "Пакет 1 кг");
  assert.equal(perishableCellText(glued, "quantity"), "6 шт.");
  assert.equal(perishableCellText(glued, "productionDate"), "24.09.2026");
  assert.equal(perishableCellText(glued, "storage"), "+2°С до +6°С, 01.10.2026 10:00");
  assert.equal(perishableCellText(glued, "storage", { joiner: "\n" }), "+2°С до +6°С\n01.10.2026 10:00");
  // Записанное одной строкой без склейки — в своей графе как есть.
  assert.equal(perishableCellText(old, "packaging"), "Лоток, 12 кг");
  assert.equal(perishableCellText(old, "quantity"), "");
  assert.equal(perishableCellText(old, "supplier"), "");
  assert.equal(perishableCellText(old, "note"), "");
  assert.equal(perishableCellText(old, "storage"), "-2°С до +2°С, 24.09.2026");
  // Изготовитель совпадает с поставщиком — это не склейка.
  assert.equal(perishableCellText(signed, "manufacturer"), "ООО «Агропродукт»");
  // Данные строк не изменены.
  assert.equal(glued.manufacturer, "ООО «Ополье» / ИП Смирнов А. В. / ИП Смирнов А. В.");
  assert.equal(qr.sourceRowKey, "employee-u1#qr-1");
});

test("хвост склейки снимается только целиком и только после «␠/␠»", () => {
  assert.equal(withoutGluedTail("Пакет 1/2 кг", "2 кг"), "Пакет 1/2 кг");
  assert.equal(withoutGluedTail("А / Б", ""), "А / Б");
  assert.equal(withoutGluedTail("/ Б", "Б"), "/ Б");
  assert.equal(withoutGluedTail("  Ополье / Смирнов ", "Смирнов"), "Ополье");
});

test("подписи прежней комиссии не теряются: строка на запись для блока под таблицей", () => {
  const config = normalizePerishableRejectionConfig({ rows: LEGACY_ROWS });
  assert.deepEqual(perishableLegacySignatureLines(config.rows), [
    "Салат листовой, поступление 21.09.2026 11:05 — Мария Смирнова (Председатель комиссии), 21.09.2026 11:40",
  ]);
  assert.deepEqual(perishableLegacySignatureLines(config.rows.slice(0, 3)), []);
});

test("печать: графы и подписи — как в таблице документа, свои колонки на своих местах", () => {
  const standard = perishablePrintColumns({});
  assert.deepEqual(standard.map((column) => column.head), APPENDIX5);
  assert.ok(standard.every((column) => column.width > 0));
  const own = perishablePrintColumns({
    columns: {
      hidden: ["document"],
      labels: {},
      custom: [{ key: "custom:t1", label: "Т °C при приёмке", type: "number" }],
      order: ["arrival", "custom:t1", ...APPENDIX5_KEYS.slice(1)],
    },
  });
  assert.equal(own[1]?.key, "custom:t1");
  assert.equal(own.length, 13, "12 граф без скрытой + своя колонка");
  assert.ok(!own.some((column) => column.key === "document"));
});

async function pdfTexts(pdf: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = await task.promise;
    const texts: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const content = await (await doc.getPage(n)).getTextContent();
      texts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " "));
    }
    return texts;
  } finally {
    await task.destroy();
  }
}

test("печать старого документа: таблица формы в ширину листа, подписи прежней комиссии — блоком под таблицей", async () => {
  const sample = buildJournalSampleInput("perishable_rejection");
  const config = { ...(sample.document.config as Record<string, unknown>), rows: LEGACY_ROWS, columns: { hidden: [], labels: {}, order: OLD_ORDER } };
  const input = { ...sample, document: { ...sample.document, config } as typeof sample.document };
  // autoTable пишет «… units width could not fit page», когда таблица шире
  // листа: до 2026-09-26 у скоропорта так уходила за край последняя графа.
  const messages: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const grab = (...args: unknown[]) => void messages.push(args.map(String).join(" "));
  console.log = grab;
  console.warn = grab;
  console.error = grab;
  let rendered: ReturnType<typeof renderJournalDocumentPdf>;
  try {
    rendered = renderJournalDocumentPdf(input);
  } finally {
    Object.assign(console, original);
  }
  assert.deepEqual(messages.filter((message) => /could not fit page/.test(message)), []);
  const text = (await pdfTexts(new Uint8Array(rendered.buffer))).join(" ");
  assert.ok(text.includes("Подписи бракеражной комиссии к записям"), "блок подписей");
  assert.ok(text.includes("Мария Смирнова (Председатель комиссии), 21.09.2026 11:40"), "подпись прежней комиссии не потеряна");
  assert.ok(text.includes("ООО «Молочник»") && text.includes("упаковка целая"), "строка по QR напечатана");
});
