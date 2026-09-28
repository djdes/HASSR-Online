/**
 * Печатный набор для владельца (распечатать и посмотреть глазами): образцы с
 * сайта и «длинные» документы пяти журналов — холодильники, склады, гигиена,
 * уборка, бракераж. Длинные — правдоподобные (не синтетика 70 строк из
 * `long-inputs.ts`): у каждого 2–4 листа, чтобы на бумаге была видна и
 * титульная страница (полная шапка с периодичностью), и продолжения
 * (компактная шапка). Данные вымышленные, организация — «Ромашка» образцов.
 *
 * QR длинных документов — того же размера, что у настоящего документа, и
 * читается телефоном на проде: адрес той же длины, что /qj/<организация>/
 * <журнал>/<подпись> (та же версия QR — те же 49/37 модулей), но ведёт на
 * открытую страницу журнала /journals-info/<журнал> — настоящую подпись /qj
 * без секрета прода не выпустить, а чужой адрес при проверке телефоном вёл
 * бы на ошибку. Образцы — как на сайте, /journals-info/<журнал>.
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import type { JournalDocumentPdfInput } from "@/lib/document-pdf";
import { journalDocumentPdfQr, journalSamplePdfQr } from "@/lib/journal-pdf-qr-link";
import { SAMPLE_USERS, buildJournalSampleInput } from "@/lib/journal-sample-fixtures";

import { LONG_ORG_ID } from "../journal-qr-header-2026-09/pages";

const ORIGIN = "https://wesetup.ru";

/** QR длинного документа печатного набора: размер как у /qj/…, ведёт на /journals-info/<журнал>. */
function printQr(code: string) {
  const target = journalDocumentPdfQr(ORIGIN, LONG_ORG_ID, code).url.length;
  const base = `${ORIGIN}/journals-info/${encodeURIComponent(code)}?from=print`;
  // Добивка строчными (байтовый режим QR, как у подписи /qj) — та же версия кода.
  return { url: base.length >= target ? base : `${base}${"x".repeat(target - base.length)}` };
}

type Doc = JournalDocumentPdfInput["document"];
type Entry = Doc["entries"][number];

function withDocument(sample: JournalDocumentPdfInput, patch: Record<string, unknown>): JournalDocumentPdfInput {
  return { ...sample, document: { ...sample.document, ...patch } as unknown as Doc };
}

function dateKeys(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

let entrySeq = 0;
function entry(employeeId: string, dateKey: string, data: Record<string, unknown>): Entry {
  entrySeq += 1;
  return {
    id: `print-entry-${entrySeq}`,
    documentId: "print-doc",
    employeeId,
    date: new Date(`${dateKey}T00:00:00.000Z`),
    data: data as unknown as Entry["data"],
    verificationStatus: null,
    verificationRejectReason: null,
    verificationDecidedById: null,
    verificationDecidedAt: null,
    createdAt: new Date(`${dateKey}T09:00:00.000Z`),
    updatedAt: new Date(`${dateKey}T09:00:00.000Z`),
  } as unknown as Entry;
}

/** Холодильники: 16 единиц, по 2 замера в день, 1–15 апреля, заполнено по 10-е. */
export function printColdEquipment(): JournalDocumentPdfInput {
  const sample = buildJournalSampleInput("cold_equipment_control");
  const units: Array<[string, number, number]> = [
    ["Холодильник №1 (мясо)", 0, 4],
    ["Холодильник №2 (молочная продукция)", 2, 6],
    ["Холодильник №3 (рыба)", -2, 2],
    ["Холодильник №4 (полуфабрикаты)", 0, 4],
    ["Холодильная камера (овощи, фрукты)", 2, 6],
    ["Холодильный стол горячего цеха", 2, 6],
    ["Холодильный стол холодного цеха", 2, 6],
    ["Витрина охлаждаемая (десерты)", 2, 6],
    ["Морозильный ларь №1 (мясо)", -20, -18],
    ["Морозильный ларь №2 (рыба)", -20, -18],
    ["Морозильная камера (полуфабрикаты)", -20, -18],
    ["Шкаф шоковой заморозки", -25, -18],
    ["Холодильник №5 (соусы, заготовки)", 2, 6],
    ["Холодильник бара (напитки)", 4, 8],
    ["Витрина охлаждаемая (салаты)", 2, 6],
    ["Морозильный ларь №3 (мороженое)", -20, -18],
  ];
  const equipment = units.map(([name, min, max], index) => ({
    id: `print-eq-${index + 1}`,
    sourceEquipmentId: null,
    name,
    min,
    max,
    readingMode: "twice",
  }));
  const config = { ...(sample.document.config as Record<string, unknown>), equipment };
  const entries = dateKeys("2026-04-01", "2026-04-10").map((dateKey, day) => {
    const temperatures: Record<string, number> = {};
    equipment.forEach((item, index) => {
      const mid = (item.min + item.max) / 2;
      temperatures[item.id] = Number((mid + (((day + index) % 3) - 1) * 0.5).toFixed(1));
      temperatures[`${item.id}#2`] = Number((mid + (((day + index + 1) % 3) - 1) * 0.5).toFixed(1));
    });
    return entry(SAMPLE_USERS[1].id, dateKey, { responsibleTitle: SAMPLE_USERS[1].positionTitle, temperatures });
  });
  return {
    ...withDocument(sample, {
      config,
      entries,
      dateFrom: new Date("2026-04-01T00:00:00Z"),
      dateTo: new Date("2026-04-15T00:00:00Z"),
    }),
    qr: printQr("cold_equipment_control"),
  };
}

/** Склады: 5 складских помещений, замер раз в день, весь апрель, заполнено по 20-е. */
export function printClimate(): JournalDocumentPdfInput {
  const sample = buildJournalSampleInput("climate_control");
  const names: Array<[string, number, number, number, number]> = [
    ["Склад сухих продуктов", 10, 18, 50, 70],
    ["Кладовая бакалеи", 10, 18, 50, 70],
    ["Склад овощей", 2, 8, 70, 90],
    ["Склад напитков", 5, 20, 40, 75],
    ["Склад упаковки и тары", 5, 25, 40, 75],
  ];
  const rooms = names.map(([name, tMin, tMax, hMin, hMax], index) => ({
    id: `print-room-${index + 1}`,
    name,
    temperature: { enabled: true, min: tMin, max: tMax },
    humidity: { enabled: true, min: hMin, max: hMax },
  }));
  const config = { ...(sample.document.config as Record<string, unknown>), rooms, controlTimes: ["10:00"] };
  const entries = dateKeys("2026-04-01", "2026-04-20").map((dateKey, day) => {
    const measurements: Record<string, Record<string, { temperature: number; humidity: number }>> = {};
    rooms.forEach((room, index) => {
      const t = (room.temperature.min + room.temperature.max) / 2 + (((day + index) % 5) - 2) * 0.4;
      const h = (room.humidity.min + room.humidity.max) / 2 + (((day + index) % 4) - 2) * 2;
      measurements[room.id] = { "10:00": { temperature: Number(t.toFixed(1)), humidity: Math.round(h) } };
    });
    return entry(SAMPLE_USERS[0].id, dateKey, { responsibleTitle: SAMPLE_USERS[0].positionTitle, measurements });
  });
  return {
    ...withDocument(sample, {
      config,
      entries,
      dateFrom: new Date("2026-04-01T00:00:00Z"),
      dateTo: new Date("2026-04-30T00:00:00Z"),
    }),
    // Печать берёт нормы по справочнику помещений (Room.climateNorms), если
    // помещение там есть; здесь справочник — сами помещения документа.
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      climateNorms: { temperature: room.temperature, humidity: room.humidity },
    })),
    qr: printQr("climate_control"),
  };
}

/** Сотрудники кухни «Ромашки» для длинной гигиены: первые пять — из образца. */
const STAFF: Array<[string, string]> = [
  ["Андреева Ольга Николаевна", "Повар"],
  ["Белов Игорь Витальевич", "Повар горячего цеха"],
  ["Васильева Наталья Сергеевна", "Кондитер"],
  ["Гусев Роман Алексеевич", "Су-шеф"],
  ["Давыдова Светлана Игоревна", "Повар холодного цеха"],
  ["Егоров Максим Андреевич", "Повар-заготовщик"],
  ["Жукова Татьяна Павловна", "Кухонный работник"],
  ["Зайцев Артём Олегович", "Пекарь"],
  ["Ильина Марина Юрьевна", "Кладовщик"],
  ["Карпов Денис Владимирович", "Повар"],
  ["Лебедева Ирина Александровна", "Мойщица посуды"],
  ["Макаров Павел Сергеевич", "Повар горячего цеха"],
  ["Никитина Юлия Викторовна", "Официант"],
  ["Орлов Кирилл Дмитриевич", "Бармен"],
  ["Павлова Екатерина Михайловна", "Официант"],
  ["Романов Алексей Игоревич", "Повар"],
  ["Соколова Дарья Андреевна", "Кухонный работник"],
  ["Тарасов Николай Петрович", "Грузчик"],
  ["Фёдорова Анастасия Олеговна", "Мойщица посуды"],
];

/** Гигиена: 24 сотрудника × 1–14 апреля (отметки — как у сотрудников образца). */
export function printHygiene(): JournalDocumentPdfInput {
  const sample = buildJournalSampleInput("hygiene");
  const users = [
    ...SAMPLE_USERS.map((u) => ({ ...u })),
    ...STAFF.map(([name, positionTitle], index) => ({
      ...SAMPLE_USERS[3],
      id: `print-user-${index + 1}`,
      name,
      positionTitle,
      email: `print-user-${index + 1}@example.com`,
    })),
  ] as JournalDocumentPdfInput["users"];
  const entries: Entry[] = [];
  users.forEach((user, index) => {
    const sampleId = SAMPLE_USERS[index % SAMPLE_USERS.length].id;
    for (const e of sample.document.entries) {
      if (e.employeeId !== sampleId) continue;
      entries.push({ ...e, id: `${e.id}-${user.id}`, employeeId: user.id });
    }
  });
  return {
    ...withDocument(sample, { entries }),
    users,
    qr: printQr("hygiene"),
  };
}

/** Уборка: 16 помещений по справочнику (как у новых документов), 1–15 апреля. */
export function printCleaning(): JournalDocumentPdfInput {
  const sample = buildJournalSampleInput("cleaning");
  const names = [
    "Горячий цех",
    "Холодный цех",
    "Заготовочный цех",
    "Мясной цех",
    "Рыбный цех",
    "Овощной цех",
    "Кондитерский цех",
    "Моечная кухонной посуды",
    "Моечная столовой посуды",
    "Склад сухих продуктов",
    "Склад овощей",
    "Раздаточная",
    "Обеденный зал",
    "Гардероб",
    "Санузел для персонала",
    "Коридор служебный",
  ];
  const cleaner = SAMPLE_USERS[4].id;
  const controller = SAMPLE_USERS[0].id;
  const rooms = names.map((name, index) => ({
    id: `print-clean-room-${index + 1}`,
    name,
    detergent: index % 2 === 0 ? "«Жавель Солид», 0,1 %" : "«Ника-Хлор», 0,06 %",
    currentScope: ["полы", "рабочие поверхности", "ручки дверей"],
    generalScope: ["стены", "оборудование", "вентиляционные решётки"],
    cleanerUserIds: [cleaner],
    verifierUserIds: [controller],
  }));
  const base = sample.document.config as Record<string, unknown>;
  const config = {
    ...base,
    cleaningMode: "rooms",
    rooms: [],
    referenceTable: [],
    responsiblePairs: [],
    selectedRoomIds: rooms.map((room) => room.id),
    selectedCleanerUserIds: [cleaner],
  };
  return {
    ...withDocument(sample, {
      config,
      dateFrom: new Date("2026-04-01T00:00:00Z"),
      dateTo: new Date("2026-04-15T00:00:00Z"),
    }),
    rooms,
    qr: printQr("cleaning"),
  };
}

/** Бракераж готовой продукции: 36 записей за две недели. */
export function printFinishedProduct(): JournalDocumentPdfInput {
  const sample = buildJournalSampleInput("finished_product");
  const base = sample.document.config as Record<string, unknown> & { rows: Array<Record<string, unknown>> };
  const dishes = [
    ["Суп-лапша куриная", "250"],
    ["Борщ со сметаной", "300"],
    ["Котлета куриная", "100"],
    ["Картофельное пюре", "150"],
    ["Гречка отварная", "150"],
    ["Салат «Витаминный»", "120"],
    ["Сырники со сметаной", "180"],
    ["Компот из сухофруктов", "200"],
    ["Плов с курицей", "250"],
  ];
  const template = base.rows[0];
  const rows = Array.from({ length: 36 }, (_, index) => {
    const day = 1 + Math.floor(index / 3);
    const [productName, portionWeight] = dishes[index % dishes.length];
    const date = `${String(day).padStart(2, "0")}.04.2026`;
    const hour = [11, 12, 13][index % 3];
    return {
      ...template,
      id: `print-fp-row-${index + 1}`,
      productionDateTime: `${date} ${String(hour).padStart(2, "0")}:15`,
      rejectionTime: `${String(hour).padStart(2, "0")}:40`,
      productName,
      organoleptic: "Внешний вид, цвет, запах, вкус и консистенция соответствуют",
      organolepticValue: "5",
      organolepticResult: "отлично",
      productTemp: productName.startsWith("Салат") || productName.startsWith("Компот") ? "8" : "72",
      releasePermissionTime: `${String(hour).padStart(2, "0")}:45`,
      portionWeight,
      releaseAllowed: "yes",
    };
  });
  return {
    ...withDocument(sample, { config: { ...base, rows } }),
    qr: printQr("finished_product"),
  };
}

export type PrintItem = { file: string; title: string; build: () => JournalDocumentPdfInput };

function sampleOf(code: "cold_equipment_control" | "climate_control" | "hygiene" | "cleaning" | "finished_product") {
  return () => ({ ...buildJournalSampleInput(code), qr: journalSamplePdfQr(ORIGIN, code) });
}

export const PRINT_ITEMS: PrintItem[] = [
  { file: "01-holodilniki-dlinnyy", title: "Холодильники — длинный документ", build: printColdEquipment },
  { file: "02-sklady-dlinnyy", title: "Склады (температура и влажность) — длинный документ", build: printClimate },
  { file: "03-gigiena-dlinnyy", title: "Гигиенический журнал — длинный документ", build: printHygiene },
  { file: "04-uborka-dlinnyy", title: "Журнал уборки — длинный документ", build: printCleaning },
  { file: "05-brakerazh-dlinnyy", title: "Бракераж готовой продукции — длинный документ", build: printFinishedProduct },
  { file: "06-holodilniki-obrazec", title: "Холодильники — образец с сайта", build: sampleOf("cold_equipment_control") },
  { file: "07-sklady-obrazec", title: "Склады — образец с сайта", build: sampleOf("climate_control") },
  { file: "08-gigiena-obrazec", title: "Гигиена — образец с сайта", build: sampleOf("hygiene") },
  { file: "09-uborka-obrazec", title: "Уборка — образец с сайта", build: sampleOf("cleaning") },
  { file: "10-brakerazh-obrazec", title: "Бракераж — образец с сайта", build: sampleOf("finished_product") },
];
