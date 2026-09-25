// Три «старых» документа скоропорта с данными, как они лежат в базе до смены
// формы (2026-09-26): без набора колонок, со старым «стандартным» набором и со
// своим набором организации. Строки — все виды, что встречаются в проде:
// полная строка с сайта, строка по QR (только поставщик и количество),
// «склейка» старой правки ячейки («изготовитель / поставщик» в одном поле),
// совсем старая строка без ключей supplier/quantity/note, строка с подписью
// прежней комиссии, забракованная строка с примечанием.
// Запуск: npx tsx .agent/tasks/perishable-official-form-2026-09/e2e/seed-legacy.ts
import { COOK_EMAIL, MANAGER_EMAIL, ORG_ID, db, readState, writeState } from "./db";

const OLD_ORDER = ["arrival", "product", "productionDate", "manufacturer", "packaging", "document", "organoleptic", "storage", "sale", "responsible", "note"];

function rows(prefix: string, cookId: string, managerId: string) {
  return [
    {
      id: `${prefix}-full`,
      arrivalDate: "2026-09-24",
      arrivalTime: "08:40",
      productName: "Сметана 20 %",
      productionDate: "2026-09-22",
      manufacturer: "ООО «Молочный комбинат «Ополье»",
      supplier: "ИП Смирнов А. В.",
      packaging: "Ведро ПЭТ 5 кг",
      quantity: "2 шт.",
      documentNumber: "ЕАЭС N RU Д-RU.РА01.В.12345/26",
      organolepticResult: "compliant",
      storageCondition: "2_6",
      expiryDate: "2026-10-06",
      expiryTime: "",
      actualSaleDate: "2026-09-25",
      actualSaleTime: "18:00",
      responsiblePerson: "Мария Смирнова, Управляющий",
      note: "",
    },
    {
      // По QR: форма телефона пишет только поставщика и количество.
      id: `${prefix}-qr`,
      arrivalDate: "2026-09-25",
      arrivalTime: "09:30",
      productName: "Молоко 3,2 %",
      productionDate: "",
      manufacturer: "",
      supplier: "ООО «Молочник»",
      packaging: "",
      quantity: "20 л",
      documentNumber: "",
      organolepticResult: "good_quality",
      storageCondition: "2_6",
      expiryDate: "",
      expiryTime: "",
      actualSaleDate: "",
      actualSaleTime: "",
      responsiblePerson: "Иван Петров, Повар",
      note: "упаковка целая",
      sourceRowKey: `employee-${cookId}#qr-1`,
    },
    {
      // Старая правка ячейки на месте писала всю склейку в одно поле.
      id: `${prefix}-glued`,
      arrivalDate: "2026-09-25",
      arrivalTime: "10:20",
      productName: "Творог 9 %",
      productionDate: "2026-09-24",
      manufacturer: "ООО «Молочный комбинат «Ополье» / ИП Смирнов А. В.",
      supplier: "ИП Смирнов А. В.",
      packaging: "Пакет 1 кг / 6 шт.",
      quantity: "6 шт.",
      documentNumber: "ТТН-250925-2",
      organolepticResult: "compliant",
      storageCondition: "2_6",
      expiryDate: "2026-10-01",
      expiryTime: "10:00",
      actualSaleDate: "",
      actualSaleTime: "",
      responsiblePerson: "Мария Смирнова, Управляющий",
      note: "",
    },
    {
      // Совсем старая строка: ключей supplier / quantity / note / expiryTime нет.
      id: `${prefix}-old`,
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
      // Подпись прежней бракеражной комиссии (до 2026-09-22).
      id: `${prefix}-signed`,
      arrivalDate: "2026-09-21",
      arrivalTime: "11:05",
      productName: "Салат листовой",
      productionDate: "2026-09-20",
      manufacturer: "ООО «Агропродукт»",
      supplier: "ООО «Агропродукт»",
      packaging: "Ящик пластиковый",
      quantity: "3 кг",
      documentNumber: "Декларация 55/26",
      organolepticResult: "compliant",
      storageCondition: "2_6",
      expiryDate: "2026-09-25",
      expiryTime: "",
      actualSaleDate: "2026-09-22",
      actualSaleTime: "12:00",
      responsiblePerson: "Мария Смирнова, Управляющий",
      note: "",
      signatures: [
        {
          userId: managerId,
          name: "Мария Смирнова",
          role: "Председатель комиссии",
          signedAt: "2026-09-21T08:40:00.000Z",
          method: "qr",
          grade: "compliant",
        },
      ],
    },
    {
      id: `${prefix}-bad`,
      arrivalDate: "2026-09-25",
      arrivalTime: "11:40",
      productName: "Пельмени с/м",
      productionDate: "2026-09-10",
      manufacturer: "АО «Останкинский МПК»",
      supplier: "ООО «Мясной двор»",
      packaging: "Пакет 1 кг",
      quantity: "10 шт.",
      documentNumber: "ТТН-250925-3",
      organolepticResult: "non_compliant",
      storageCondition: "minus18",
      expiryDate: "2026-12-10",
      expiryTime: "",
      actualSaleDate: "",
      actualSaleTime: "",
      responsiblePerson: "Иван Петров, Повар",
      note: "Вздутие упаковки — возврат поставщику",
    },
  ];
}

async function main() {
  const template = await db.journalTemplate.findFirstOrThrow({ where: { code: "perishable_rejection" }, select: { id: true } });
  const manager = await db.user.findUniqueOrThrow({ where: { email: MANAGER_EMAIL }, select: { id: true } });
  const cook = await db.user.findUniqueOrThrow({ where: { email: COOK_EMAIL }, select: { id: true } });
  const lists = {
    productLists: [{ id: "perishable-list-e2e", name: "Изделия", items: ["Сметана 20 %", "Молоко 3,2 %", "Творог 9 %"] }],
    manufacturers: ["ООО «Молочный комбинат «Ополье»", "АО «Останкинский МПК»"],
    suppliers: ["ИП Смирнов А. В.", "ООО «Молочник»", "ООО «Мясной двор»"],
  };
  const variants: Array<{ key: string; title: string; extra: Record<string, unknown> }> = [
    { key: "docNoColumns", title: "Скоропорт E2E — старый без набора колонок", extra: { showNote: true } },
    {
      key: "docOldStandard",
      title: "Скоропорт E2E — старый «Стандартная форма»",
      extra: { showNote: true, columns: { hidden: [], labels: {}, order: OLD_ORDER } },
    },
    {
      key: "docOwnTemplate",
      title: "Скоропорт E2E — свой набор организации",
      extra: {
        showNote: true,
        columns: {
          hidden: ["document"],
          labels: { product: "Продукт" },
          custom: [{ key: "custom:t1", label: "Т °C при приёмке", type: "number", unit: "°C" }],
          order: ["product", "arrival", "manufacturer", "packaging", "custom:t1", "productionDate", "document", "organoleptic", "storage", "sale", "responsible", "note"],
        },
      },
    },
  ];

  // Копия своего набора — для проверки «применить шаблон из настроек»
  // (e2e меняет её колонки; сам «свой набор» остаётся для печати «после»).
  variants.push({ ...variants[2], key: "docTemplateApply", title: "Скоропорт E2E — применение шаблона" });

  const state = readState();
  for (const variant of variants) {
    if (state[variant.key]) {
      await db.journalDocument.deleteMany({ where: { id: state[variant.key], organizationId: ORG_ID } });
    }
    const doc = await db.journalDocument.create({
      data: {
        organizationId: ORG_ID,
        templateId: template.id,
        title: variant.title,
        dateFrom: new Date("2026-09-01T00:00:00.000Z"),
        dateTo: new Date("2026-09-30T00:00:00.000Z"),
        status: "active",
        responsibleUserId: manager.id,
        config: { ...lists, rows: rows(variant.key, cook.id, manager.id), commissionMembers: [], ...variant.extra } as never,
      },
      select: { id: true },
    });
    state[variant.key] = doc.id;
    console.log("doc", variant.key, doc.id);
  }
  writeState(state);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
