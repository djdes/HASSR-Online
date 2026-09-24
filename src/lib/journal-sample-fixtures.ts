import { getRegisterJournal } from "@/lib/register-journals";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { getDefaultConfigForJournal } from "@/lib/journal-default-configs";
import {
  buildExampleHygieneEntryMap,
  type HygieneEntryData,
} from "@/lib/hygiene-document";
import {
  normalizeClimateDocumentConfig,
  type ClimateEntryData,
} from "@/lib/climate-document";
import {
  normalizeColdEquipmentDocumentConfig,
  type ColdEquipmentEntryData,
} from "@/lib/cold-equipment-document";
import type { JournalDocumentPdfInput } from "@/lib/document-pdf";

/**
 * Заполненные образцы журналов для публичного лендинга.
 *
 * Витрина, а не выгрузка: организация, сотрудники и показания
 * вымышленные, в БД ничего не читается. Тем же кодом рендерится и
 * настоящий журнал клиента — расхождения между «образцом» и тем, что
 * человек получит после регистрации, быть не может.
 *
 * Данные проходят через штатные нормализаторы каждого журнала: если
 * схема поменяется, образец сломается на сборке, а не тихо на проде.
 */

/** Организация-витрина. Совпадает с мокапом бланка в шапке лендинга. */
export const SAMPLE_ORGANIZATION = {
  name: "ООО «Ромашка»",
  journalShortName: null,
  legalProfileJson: null,
  inn: "7701234567",
  address: "г. Москва, ул. Пищевая, д. 12",
  phone: "+7 495 000-00-00",
};

export const SAMPLE_USERS = [
  {
    id: "sample-user-1",
    name: "Иванова Мария Петровна",
    role: "manager",
    email: "sample1@example.com",
    positionTitle: "Заведующая производством",
  },
  {
    id: "sample-user-2",
    name: "Петров Сергей Иванович",
    role: "head_chef",
    email: "sample2@example.com",
    positionTitle: "Шеф-повар",
  },
  {
    id: "sample-user-3",
    name: "Сидорова Анна Викторовна",
    role: "cook",
    email: "sample3@example.com",
    positionTitle: "Повар холодного цеха",
  },
  {
    id: "sample-user-4",
    name: "Кузнецов Дмитрий Олегович",
    role: "cook",
    email: "sample4@example.com",
    positionTitle: "Повар горячего цеха",
  },
  {
    id: "sample-user-5",
    name: "Морозова Елена Андреевна",
    role: "cleaner",
    email: "sample5@example.com",
    positionTitle: "Уборщица",
  },
];

export const SAMPLE_AREAS = [
  { id: "sample-area-1", name: "Горячий цех" },
  { id: "sample-area-2", name: "Холодный цех" },
  { id: "sample-area-3", name: "Моечная" },
  { id: "sample-area-4", name: "Склад сухих продуктов" },
];

export const SAMPLE_EQUIPMENT = [
  {
    id: "sample-eq-1",
    name: "Холодильник №1 (мясо)",
    type: "fridge",
    tempMin: 0,
    tempMax: 4,
  },
  {
    id: "sample-eq-2",
    name: "Холодильник №2 (молочка)",
    type: "fridge",
    tempMin: 2,
    tempMax: 6,
  },
  {
    id: "sample-eq-3",
    name: "Морозильный ларь",
    type: "freezer",
    tempMin: -20,
    tempMax: -18,
  },
];

export const SAMPLE_PRODUCTS = [
  { id: "sample-product-1", name: "Салат «Цезарь»" },
  { id: "sample-product-2", name: "Суп-пюре грибной" },
  { id: "sample-product-3", name: "Котлета по-киевски" },
];

/**
 * Период образца — фиксированный, а не «последние две недели»:
 * иначе один и тот же файл менялся бы каждый день, и его нельзя было
 * бы закешировать на CDN.
 */
export const SAMPLE_DATE_FROM = new Date("2026-04-01T00:00:00.000Z");
export const SAMPLE_DATE_TO = new Date("2026-04-14T00:00:00.000Z");

/**
 * Журналы, для которых отдаём образец, — весь активный каталог.
 *
 * Список не дублируем: коды и названия берём из journal-catalog, иначе
 * при добавлении журнала образец пришлось бы вписывать вторым местом,
 * и он бы про него забыли.
 */
export const SAMPLE_JOURNAL_CODES = ACTIVE_JOURNAL_CATALOG.map(
  (item) => item.code
);

export type SampleJournalCode = string;

const SAMPLE_CODE_SET = new Set<string>(SAMPLE_JOURNAL_CODES);

export function isSampleJournalCode(code: string): code is SampleJournalCode {
  return SAMPLE_CODE_SET.has(code);
}

/** Ключи дат образца: 14 дней подряд, ISO YYYY-MM-DD. */
function sampleDateKeys(): string[] {
  const out: string[] = [];
  const cursor = new Date(SAMPLE_DATE_FROM);
  while (cursor <= SAMPLE_DATE_TO) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * Шаблон журнала. Значения полей — те же, что сеет prisma/seed.ts:
 * рендерер читает из шаблона только `code`, `name` и `fields`, но
 * тип требует полную строку.
 */
function sampleTemplate(code: string, name: string) {
  return {
    id: `sample-template-${code}`,
    code,
    name,
    description: null,
    // Реестрам без своего экрана колонки бланка дают поля шаблона —
    // без них образец печатался бы одной колонкой «№».
    fields: (getRegisterJournal(code)?.fields ?? []) as unknown as never,
    isActive: true,
    sortOrder: 0,
    isMandatorySanpin: true,
    isMandatoryHaccp: false,
    fillMode: "per-employee",
    defaultAssigneeId: null,
    bonusAmountKopecks: 0,
    taskScope: "personal",
    allowNoEvents: true,
    noEventsReasons: [] as unknown as never,
    allowFreeTextReason: false,
  };
}

function sampleDocument(
  code: string,
  name: string,
  config: Record<string, unknown>
) {
  return {
    id: `sample-doc-${code}`,
    templateId: `sample-template-${code}`,
    organizationId: "sample-org",
    title: name,
    config: config as unknown as never,
    dateFrom: SAMPLE_DATE_FROM,
    dateTo: SAMPLE_DATE_TO,
    responsibleUserId: SAMPLE_USERS[0].id,
    responsibleTitle: SAMPLE_USERS[0].positionTitle,
    verifierUserId: null,
    verificationStatus: null,
    verificationDecidedById: null,
    verificationDecidedAt: null,
    verificationRejectReason: null,
    status: "active",
    autoFill: false,
    createdById: SAMPLE_USERS[0].id,
    createdAt: SAMPLE_DATE_FROM,
    updatedAt: SAMPLE_DATE_TO,
    template: sampleTemplate(code, name),
    organization: SAMPLE_ORGANIZATION,
  };
}

let entrySeq = 0;
function sampleEntry(
  employeeId: string,
  dateKey: string,
  data: Record<string, unknown>
) {
  entrySeq += 1;
  return {
    id: `sample-entry-${entrySeq}`,
    documentId: "sample-doc",
    employeeId,
    date: new Date(`${dateKey}T00:00:00.000Z`),
    data: data as unknown as never,
    verificationStatus: null,
    verificationRejectReason: null,
    verificationDecidedById: null,
    verificationDecidedAt: null,
    createdAt: new Date(`${dateKey}T09:00:00.000Z`),
    updatedAt: new Date(`${dateKey}T09:00:00.000Z`),
  };
}

/** Названия журналов — из каталога, чтобы не разъезжались с сайтом. */
const SAMPLE_TITLES: Record<string, string> = Object.fromEntries(
  ACTIVE_JOURNAL_CATALOG.map((item) => [item.code, item.name])
);

/**
 * Показания приборов образца. Значения в пределах нормы, кроме одной
 * намеренной отметки — по ней видно, что сервис подсвечивает выход за
 * границы, а не рисует ровный «идеальный» журнал.
 */
function buildHygieneEntries() {
  const dateKeys = sampleDateKeys();
  const employeeIds = SAMPLE_USERS.map((u) => u.id);
  const map = buildExampleHygieneEntryMap(employeeIds, dateKeys) as Record<
    string,
    HygieneEntryData
  >;
  return Object.entries(map).map(([key, data]) => {
    const [employeeId, dateKey] = key.split(":");
    return sampleEntry(employeeId, dateKey, data as Record<string, unknown>);
  });
}

function buildHealthEntries() {
  const out: ReturnType<typeof sampleEntry>[] = [];
  for (const dateKey of sampleDateKeys()) {
    for (const user of SAMPLE_USERS) {
      out.push(
        sampleEntry(user.id, dateKey, {
          signed: true,
          measures: null,
        })
      );
    }
  }
  return out;
}

function buildClimateEntries(config: Record<string, unknown>) {
  const normalized = normalizeClimateDocumentConfig(config);
  const out: ReturnType<typeof sampleEntry>[] = [];
  const dateKeys = sampleDateKeys();

  dateKeys.forEach((dateKey, dayIndex) => {
    const measurements: ClimateEntryData["measurements"] = {};
    normalized.rooms.forEach((room, roomIndex) => {
      const perTime: Record<string, { temperature: number; humidity: number }> =
        {};
      normalized.controlTimes.forEach((time, timeIndex) => {
        // Цех прогревается к вечеру, поэтому вторая проверка теплее —
        // ровные одинаковые числа в журнале выглядят как приписка.
        const drift = (dayIndex % 3) * 0.4 + timeIndex * 0.6 + roomIndex * 0.3;
        perTime[time] = {
          temperature: Number((18.4 + drift).toFixed(1)),
          humidity: Math.round(52 + ((dayIndex + timeIndex) % 5) * 2),
        };
      });
      measurements[room.id] = perTime;
    });

    out.push(
      sampleEntry(SAMPLE_USERS[0].id, dateKey, {
        responsibleTitle: SAMPLE_USERS[0].positionTitle,
        measurements,
      })
    );
  });

  return out;
}

function buildColdEquipmentEntries(config: Record<string, unknown>) {
  const normalized = normalizeColdEquipmentDocumentConfig(config);
  const out: ReturnType<typeof sampleEntry>[] = [];

  sampleDateKeys().forEach((dateKey, dayIndex) => {
    const temperatures: ColdEquipmentEntryData["temperatures"] = {};
    normalized.equipment.forEach((item, index) => {
      const source = SAMPLE_EQUIPMENT.find((e) => e.name === item.name);
      const min = source?.tempMin ?? 0;
      const max = source?.tempMax ?? 4;
      const mid = (min + max) / 2;
      temperatures[item.id] = Number(
        (mid + (((dayIndex + index) % 3) - 1) * 0.5).toFixed(1)
      );
    });
    out.push(
      sampleEntry(SAMPLE_USERS[1].id, dateKey, {
        responsibleTitle: SAMPLE_USERS[1].positionTitle,
        temperatures,
      })
    );
  });

  return out;
}

/**
 * Собирает вход для рендерера PDF по коду журнала.
 *
 * Конфигурация берётся штатным `getDefaultConfigForJournal` — той же
 * функцией, что отрабатывает при создании настоящего документа в
 * кабинете. Поэтому образец показывает реальную структуру бланка, а
 * не нарисованную отдельно копию.
 */
/**
 * Строки образца для табличных реестров (register-journals.ts): у них
 * записи живут в `config.rows`, а штатный генератор конфигурации строк
 * не создаёт — без этого образец был бы пустой таблицей.
 */
const SAMPLE_REGISTER_ROWS: Record<string, Array<Record<string, string>>> = {
  daily_samples: [
    { date: "2026-04-01", meal: "Завтрак", dish: "Каша овсяная молочная", mass: "150", takenAt: "08:10", storageTemp: "4", disposedAt: "03.04 в 08:15", responsible: "Иванова М. П." },
    { date: "2026-04-01", meal: "Обед", dish: "Суп гороховый", mass: "100", takenAt: "12:05", storageTemp: "4", disposedAt: "03.04 в 12:10", responsible: "Иванова М. П." },
  ],
  vitaminization: [
    { date: "2026-04-01", dish: "Компот из сухофруктов", preparation: "Аскорбиновая кислота", portions: "120", amount: "6", addedAt: "11:40", servedAt: "12:15", responsible: "Иванова М. П." },
    { date: "2026-04-02", dish: "Кисель ягодный", preparation: "Аскорбиновая кислота", portions: "118", amount: "5.9", addedAt: "11:45", servedAt: "12:20", responsible: "Иванова М. П." },
  ],
  ration_control: [
    { period: "01.04–10.04", productGroup: "Молоко и кисломолочные продукты", normPerPerson: "350", factPerPerson: "340", deviation: "-2.9", note: "" },
    { period: "01.04–10.04", productGroup: "Овощи свежие", normPerPerson: "280", factPerPerson: "290", deviation: "3.6", note: "" },
  ],
  transport_temperature: [
    { date: "2026-04-01", vehicle: "Газель А123БВ", route: "Школа № 5", product: "Обеды в термоконтейнерах", loadTemp: "75", unloadTemp: "68", time: "11:30", responsible: "Петров С. А." },
    { date: "2026-04-02", vehicle: "Газель А123БВ", route: "Детсад «Солнышко»", product: "Молочная продукция", loadTemp: "3", unloadTemp: "5", time: "07:50", responsible: "Петров С. А." },
  ],
  tableware_breakage: [
    { date: "2026-04-03", item: "Тарелка глубокая", quantity: "1", zone: "Зал", cause: "Упала с подноса", fragments: "Да", responsible: "Сидорова А. В." },
    { date: "2026-04-09", item: "Стакан", quantity: "2", zone: "Бар", cause: "Трещина при мойке", fragments: "Да", responsible: "Сидорова А. В." },
  ],
  pool_water_control: [
    { date: "2026-04-01", time: "07:00", pool: "Большой бассейн", waterTemp: "27", freeChlorine: "0.4", boundChlorine: "0.1", ph: "7.4", transparency: "Видна разметка дна", visitors: "", responsible: "Кузнецов Д. И." },
    { date: "2026-04-01", time: "13:00", pool: "Большой бассейн", waterTemp: "27.5", freeChlorine: "0.5", boundChlorine: "0.1", ph: "7.3", transparency: "Видна разметка дна", visitors: "34", responsible: "Кузнецов Д. И." },
  ],
};

export function buildJournalSampleInput(
  code: SampleJournalCode
): JournalDocumentPdfInput {
  // Витрина: образцы-фикстуры (стоковые холодильники, приходы дезсредств)
  // здесь нужны, поэтому организация помечена как демо.
  const config = getDefaultConfigForJournal(code, {
    areas: SAMPLE_AREAS,
    equipment: SAMPLE_EQUIPMENT,
    users: SAMPLE_USERS.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    products: SAMPLE_PRODUCTS,
    isDemo: true,
  });

  const title = SAMPLE_TITLES[code] ?? code;
  const registerRows = SAMPLE_REGISTER_ROWS[code];
  if (registerRows) {
    config.rows = registerRows.map((values, index) => ({
      id: `sample-row-${code}-${index + 1}`,
      values,
    }));
  }
  const document = sampleDocument(code, title, config);

  let entries: ReturnType<typeof sampleEntry>[] = [];
  if (code === "hygiene") {
    entries = buildHygieneEntries();
  } else if (code === "health_check") {
    entries = buildHealthEntries();
  } else if (code === "climate_control") {
    entries = buildClimateEntries(config);
  } else if (code === "cold_equipment_control") {
    entries = buildColdEquipmentEntries(config);
  }
  // Остальные журналы ведут строки в самом `config`, а не в entries:
  // их бланк заполнен ровно настолько, насколько его заполняет
  // штатный генератор конфигурации при создании документа.

  return {
    document: {
      ...document,
      entries,
    } as unknown as JournalDocumentPdfInput["document"],
    users: SAMPLE_USERS,
    equipment: SAMPLE_EQUIPMENT.map((e) => ({ id: e.id, name: e.name })),
    rooms: SAMPLE_AREAS,
  };
}
