export const FRYER_OIL_TEMPLATE_CODE = "fryer_oil";

export const FRYER_OIL_PAGE_TITLE = "Журнал учета использования фритюрных жиров";

// Default select list values
export const DEFAULT_FAT_TYPES = [
  "Подсолнечное масло",
  "Пальмовое масло",
  "Соевое масло",
  "Рапсовое масло",
  "Кокосовое масло",
];

export const DEFAULT_EQUIPMENT_TYPES = [
  "Фритюрница №1",
  "Фритюрница №2",
  "Фритюрница №3",
];

/**
 * Группы продукции, которую жарят во фритюре.
 *
 * ВАЖНО про смысл графы. Одна строка журнала — это один день работы
 * фритюра, а не одно блюдо: органолептическая оценка ставится МАСЛУ в
 * целом, сколько бы разных продуктов в нём ни приготовили. Поэтому в
 * графу пишут либо общую группу («Продукция во фритюре (в ассортименте)»),
 * либо основные позиции через запятую в одной ячейке.
 *
 * Список забит заранее и намеренно широкий: повару не нужно вспоминать
 * формулировку, он отмечает то, что жарил. Раньше здесь лежали
 * «Вареники, Пельмени, Подсолнечное масло» — последнее вообще масло, а
 * не продукт, и в графу продукции попадать не должно.
 */
export const DEFAULT_PRODUCT_TYPES = [
  "Продукция во фритюре (в ассортименте)",
  "Картофель фри",
  "Наггетсы",
  "Куриные крылышки",
  "Сырные палочки",
  "Луковые кольца",
  "Пирожки",
  "Чебуреки",
  "Беляши",
  "Пончики",
  "Хворост",
  "Рыба в кляре",
  "Креветки в кляре",
  "Овощи во фритюре",
  "Вареники",
  "Пельмени",
];

/**
 * Готовые формулировки органолептической оценки — их пишут словами, и
 * это первое, на что смотрит проверяющий. Повар не должен сочинять
 * формулировку сам: список закрывает и «в начале смены», и «в конце».
 */
export const DEFAULT_QUALITY_PHRASES = [
  "Доброкачественное, без постороннего запаха",
  "Цвет светлый, свойственный данному виду",
  "Вкус и запах свойственные, цвет янтарный",
  "Слабо выраженный привкус, цвет коричневатый",
  "Горький привкус, резкий запах — к утилизации",
];

/** Что делают с остатком жира по окончании смены. */
export const FRYER_OIL_RESIDUE_ACTIONS = [
  "Оставлено для дальнейшего использования",
  "Утилизировано",
  "Сдано на переработку",
] as const;

// Quality score labels (1–5)
export const QUALITY_LABELS: Record<number, string> = {
  5: "Отличное",
  4: "Хорошее",
  3: "Удовлетворительное",
  2: "Неудовлетворительное",
  1: "Неудовлетворительное",
};

// Full quality assessment reference table (Приложение)
export const QUALITY_ASSESSMENT_TABLE = {
  indicators: [
    // Формулировки первого столбца и строки «Запах» — дословно по эталону
    // lk.haccp-online.ru (docs/reference/haccp-online/screenshots/
    // fryer_oil-grid.png), включая условия замера в скобках.
    {
      name: "Цвет (в проходящем и отраженном свете на белом фоне при температуре 40°C)",
      scores: {
        5: "Соломенно-желтый",
        4: "Интенсивно-желтый с коричневым оттенком",
        3: "Светло-коричневый",
        2: "Коричневый или темно-коричневый",
        1: "Коричневый или темно-коричневый",
      },
      coefficient: 3,
    },
    {
      name: "Вкус",
      scores: {
        5: "Без постороннего привкуса",
        4: "Слабо выраженный горьковатый",
        3: "Горький, с ярко выраженным посторонним привкусом",
        2: "Очень горький, вызывающий неприятное ощущение першения",
        1: "Очень горький, вызывающий неприятное ощущение першения",
      },
      coefficient: 2,
    },
    {
      name: "Запах (при температуре не ниже 50°C)",
      scores: {
        5: "Без постороннего запаха",
        4: "Слабо выраженный, неприятный, продуктов термического распада масла",
        3: "Выраженный, неприятный, продуктов термического распада масла",
        2: "Резкий, неприятный, продуктов термического распада масла",
        1: "Резкий, неприятный, продуктов термического распада масла",
      },
      coefficient: 2,
    },
  ],
  // Эталон (lk.haccp-online.ru, fryer_oil-2-doc.png) держит ЧЕТЫРЕ строки:
  // «неудовлетворительное» — одна строка с баллом «2 или 1», а не два
  // дубля с одинаковой подписью. Балл поэтому строка, а не число.
  gradingTable: [
    { label: "Отличное", score: "5" },
    { label: "Хорошее", score: "4" },
    { label: "Удовлетворительное", score: "3" },
    { label: "Неудовлетворительное", score: "2 или 1" },
  ],
  formulaExample: "(4 x 3 + 3 x 2 + 3 x 2)/7 = 3,4",
  // Расшифровка формулы — дословно по эталону, отдельными строками.
  formulaExplanation: [
    "где в числителе:",
    "4, 3, 3 - баллы по показателям качества",
    "3, 2, 2 - коэффициенты важности",
    "в знаменателе:",
    "7 - сумма коэффициента важности",
  ],
};

// Types
export type FryerOilSelectLists = {
  fatTypes: string[];
  equipmentTypes: string[];
  productTypes: string[];
};

/**
 * Смена, в которую работает фритюрница.
 *
 * Нужна затем, чтобы форма подставляла типичные часы, а не текущее
 * время: повар открывает журнал когда придётся, а жарка идёт с начала
 * смены. Часы всё равно остаются в поле — человек их видит и правит.
 */
export type FryerOilShift = {
  /** `HH:MM`. Начало смены. */
  startTime: string;
  /** `HH:MM`. Конец смены. */
  endTime: string;
};

export const DEFAULT_FRYER_OIL_SHIFT: FryerOilShift = {
  startTime: "07:00",
  endTime: "16:00",
};

/**
 * Фритюрница справочника «Оборудование», связанная с журналом
 * (2026-10-17, как `sourceEquipmentId` у холодильников). Имя — то, что
 * стоит в `lists.equipmentTypes`; переименование в справочнике меняет его
 * и там. Синхронизация — `fryer-oil-equipment-link.ts`.
 */
export type FryerOilEquipmentLink = {
  sourceEquipmentId: string;
  name: string;
};

export type FryerOilDocumentConfig = {
  lists: FryerOilSelectLists;
  shift: FryerOilShift;
  /** Фритюрницы из «Оборудования» в списке `lists.equipmentTypes`. */
  equipmentLinks: FryerOilEquipmentLink[];
  /**
   * Когда журнал закончили. В шапке закрытого документа стояла дата
   * НАЧАЛА («Окончен 01-09-2026»), потому что реальной даты закрытия
   * нигде не хранилось.
   */
  finishedAt?: string | null;
};

/** `HH:MM` → часы и минуты. Мусор на входе даёт `null`. */
export function parseShiftTime(
  value: string
): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function normalizeShiftTime(value: unknown, fallback: string): string {
  return typeof value === "string" && parseShiftTime(value) ? value.trim() : fallback;
}

export function normalizeFryerOilShift(value: unknown): FryerOilShift {
  const item =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    startTime: normalizeShiftTime(item.startTime, DEFAULT_FRYER_OIL_SHIFT.startTime),
    endTime: normalizeShiftTime(item.endTime, DEFAULT_FRYER_OIL_SHIFT.endTime),
  };
}

/**
 * Время и оценки качества — nullable. ПОЧЕМУ: сидер создаёт строку на
 * каждый день периода (структура «дата → строка» нужна), но сама строка
 * пустая — `{_autoSeeded:true}`. Раньше нормализация подставляла
 * qualityStart/qualityEnd = 5 («Отличное») и endHour = 17, и свежий
 * журнал открывался «идеально заполненным на месяц вперёд» — для
 * инспектора это выдуманные записи. Теперь незаполненное = null и
 * рисуется прочерком.
 */
export type FryerOilEntryData = {
  startDate: string;                // ISO date string "YYYY-MM-DD"
  startHour: number | null;         // 0–23
  startMinute: number | null;       // 0–59
  fatType: string;
  qualityStart: number | null;      // 1–5
  equipmentType: string;
  productType: string;
  endHour: number | null;           // 0–23
  endMinute: number | null;         // 0–59
  qualityEnd: number | null;        // 1–5
  /**
   * Оценка словами — то, что реально читает проверяющий: «доброкачественное»,
   * «без постороннего запаха», «цвет янтарный». Балл 1–5 остаётся: он нужен
   * методике из приложения к журналу, но в графу бланка идёт формулировка.
   */
  qualityStartNote?: string;
  qualityEndNote?: string;
  carryoverKg: number;              // остаток жира, кг
  disposedKg: number;               // слито/утилизировано, кг
  controllerName: string;
  /** Фритюрница справочника этой строки (QR-наклейка, переименование). */
  sourceEquipmentId?: string | null;
};

// Factory / default helpers
export function defaultFryerOilDocumentConfig(): FryerOilDocumentConfig {
  return {
    shift: { ...DEFAULT_FRYER_OIL_SHIFT },
    lists: {
      fatTypes: [...DEFAULT_FAT_TYPES],
      equipmentTypes: [...DEFAULT_EQUIPMENT_TYPES],
      productTypes: [...DEFAULT_PRODUCT_TYPES],
    },
    equipmentLinks: [],
    finishedAt: null,
  };
}

// Normalizers
function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value.filter((v) => typeof v === "string" && v.trim()).map((v) => (v as string).trim());
}

export function normalizeFryerOilSelectLists(value: unknown): FryerOilSelectLists {
  const defaults = defaultFryerOilDocumentConfig().lists;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }
  const item = value as Record<string, unknown>;
  return {
    fatTypes: normalizeStringArray(item.fatTypes, defaults.fatTypes),
    equipmentTypes: normalizeStringArray(item.equipmentTypes, defaults.equipmentTypes),
    productTypes: normalizeStringArray(item.productTypes, defaults.productTypes),
  };
}

export function normalizeFryerOilEquipmentLinks(value: unknown): FryerOilEquipmentLink[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const links: FryerOilEquipmentLink[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.sourceEquipmentId === "string" ? item.sourceEquipmentId.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    links.push({ sourceEquipmentId: id, name });
  }
  return links;
}

export function normalizeFryerOilDocumentConfig(value: unknown): FryerOilDocumentConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultFryerOilDocumentConfig();
  }
  const item = value as Record<string, unknown>;
  return {
    lists: normalizeFryerOilSelectLists(item.lists),
    shift: normalizeFryerOilShift(item.shift),
    equipmentLinks: normalizeFryerOilEquipmentLinks(item.equipmentLinks),
    finishedAt:
      typeof item.finishedAt === "string" && item.finishedAt.trim()
        ? item.finishedAt.trim()
        : null,
  };
}

/**
 * День, к которому относится строка журнала.
 *
 * У строк-заготовок (журнал создаёт по одной на каждый день периода)
 * `startDate` пустой, и день несёт только техническое поле `date`.
 * Фолбэк обязателен, иначе все заготовки склеятся в один «пустой день».
 */
export function fryerOilDayKey(entry: {
  date: string;
  data: { startDate: string };
}): string {
  return entry.data.startDate || entry.date.slice(0, 10);
}

export function normalizeFryerOilEntryData(value: unknown): FryerOilEntryData {
  const defaults: FryerOilEntryData = {
    startDate: "",
    startHour: null,
    startMinute: null,
    fatType: "",
    qualityStart: null,
    equipmentType: "",
    productType: "",
    endHour: null,
    endMinute: null,
    qualityEnd: null,
    carryoverKg: 0,
    disposedKg: 0,
    controllerName: "",
  };

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const item = value as Record<string, unknown>;

  function safeInt(
    v: unknown,
    fallback: number | null,
    min?: number,
    max?: number
  ): number | null {
    const n = typeof v === "number" ? Math.round(v) : typeof v === "string" ? parseInt(v, 10) : NaN;
    if (isNaN(n)) return fallback;
    if (min !== undefined && n < min) return fallback;
    if (max !== undefined && n > max) return fallback;
    return n;
  }

  function safeFloat(v: unknown, fallback: number): number {
    const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
    if (isNaN(n) || n < 0) return fallback;
    return n;
  }

  return {
    startDate: typeof item.startDate === "string" ? item.startDate : defaults.startDate,
    startHour: safeInt(item.startHour, defaults.startHour, 0, 23),
    startMinute: safeInt(item.startMinute, defaults.startMinute, 0, 59),
    fatType: typeof item.fatType === "string" ? item.fatType : defaults.fatType,
    qualityStart: safeInt(item.qualityStart, defaults.qualityStart, 1, 5),
    equipmentType: typeof item.equipmentType === "string" ? item.equipmentType : defaults.equipmentType,
    productType: typeof item.productType === "string" ? item.productType : defaults.productType,
    endHour: safeInt(item.endHour, defaults.endHour, 0, 23),
    endMinute: safeInt(item.endMinute, defaults.endMinute, 0, 59),
    qualityEnd: safeInt(item.qualityEnd, defaults.qualityEnd, 1, 5),
    carryoverKg: safeFloat(item.carryoverKg, defaults.carryoverKg),
    disposedKg: safeFloat(item.disposedKg, defaults.disposedKg),
    controllerName: typeof item.controllerName === "string" ? item.controllerName : defaults.controllerName,
    // Оценка словами терялась при каждом сохранении: нормализация её не
    // переносила, и в графе оставался только балл.
    ...(typeof item.qualityStartNote === "string" && item.qualityStartNote.trim()
      ? { qualityStartNote: item.qualityStartNote.trim() }
      : {}),
    ...(typeof item.qualityEndNote === "string" && item.qualityEndNote.trim()
      ? { qualityEndNote: item.qualityEndNote.trim() }
      : {}),
    ...(typeof item.sourceEquipmentId === "string" && item.sourceEquipmentId.trim()
      ? { sourceEquipmentId: item.sourceEquipmentId.trim() }
      : {}),
  };
}

/**
 * Пустая строка фритюрного журнала: ни одного показателя не внесено.
 * Сид-заготовки (`{_autoSeeded:true}`) нормализуются ровно в такую
 * форму — автозаполнение имеет право её перезаписать.
 */
export function isFryerOilEntryDataEmpty(data: FryerOilEntryData): boolean {
  return (
    !data.startDate &&
    data.startHour === null &&
    data.startMinute === null &&
    !data.fatType &&
    data.qualityStart === null &&
    !data.equipmentType &&
    !data.productType &&
    data.endHour === null &&
    data.endMinute === null &&
    data.qualityEnd === null &&
    !data.qualityStartNote &&
    !data.qualityEndNote &&
    data.carryoverKg === 0 &&
    data.disposedKg === 0 &&
    !data.controllerName
  );
}

/**
 * Штатная формулировка органолептической оценки по баллу. Фразу
 * «к утилизации» автозаполнение НЕ пишет никогда: повторяющийся каждый
 * день текст инцидента выглядит абсурдно, решение об утилизации —
 * человеческое.
 */
function qualityPhraseForScore(score: number | null): string {
  if (score === null) return "";
  if (score >= 5) return DEFAULT_QUALITY_PHRASES[0];
  if (score === 4) return DEFAULT_QUALITY_PHRASES[2];
  return DEFAULT_QUALITY_PHRASES[3];
}

/**
 * Строка автозаполнения фритюрного журнала: copy-forward из источника
 * (последний заполненный день этого или предыдущего документа).
 *
 *   • жир / оборудование / продукция / оценки / остаток — из source;
 *     без source — первые значения из справочников config и оценка 5;
 *   • `startDate = dateKey`, времена — из `config.shift` (типовая смена);
 *   • примечания — штатная фраза по оценке (не «к утилизации»);
 *   • `disposedKg = 0` — утилизацию автозаполнение не выдумывает.
 */
export function buildFryerOilAutoFillEntryData(params: {
  config: FryerOilDocumentConfig;
  dateKey: string;
  source: FryerOilEntryData | null;
  controllerFallback: string;
}): FryerOilEntryData {
  const { config, dateKey, source, controllerFallback } = params;
  const start = parseShiftTime(config.shift.startTime) ?? { hour: 7, minute: 0 };
  const end = parseShiftTime(config.shift.endTime) ?? { hour: 16, minute: 0 };
  const qualityStart = source?.qualityStart ?? 5;
  const qualityEnd = source?.qualityEnd ?? qualityStart;
  return {
    startDate: dateKey,
    startHour: start.hour,
    startMinute: start.minute,
    fatType: source?.fatType || config.lists.fatTypes[0] || "",
    qualityStart,
    equipmentType: source?.equipmentType || config.lists.equipmentTypes[0] || "",
    productType: source?.productType || config.lists.productTypes[0] || "",
    endHour: end.hour,
    endMinute: end.minute,
    qualityEnd,
    qualityStartNote: qualityPhraseForScore(qualityStart),
    qualityEndNote: qualityPhraseForScore(qualityEnd),
    carryoverKg: source?.carryoverKg ?? 0,
    disposedKg: 0,
    controllerName: source?.controllerName || controllerFallback,
    ...(source?.equipmentType && source.sourceEquipmentId
      ? { sourceEquipmentId: source.sourceEquipmentId }
      : {}),
  };
}

/**
 * Оценка словами для QR-формы фритюрницы. Здесь балл ставит человек,
 * поэтому «к утилизации» допустимо (в отличие от автозаполнения).
 */
export function fryerOilQualityPhrase(score: number | null): string {
  if (score === null) return "";
  if (score >= 5) return DEFAULT_QUALITY_PHRASES[0];
  if (score === 4) return DEFAULT_QUALITY_PHRASES[2];
  if (score === 3) return DEFAULT_QUALITY_PHRASES[3];
  return DEFAULT_QUALITY_PHRASES[4];
}

// Public accessors
export function getFryerOilDocumentTitle(): string {
  return FRYER_OIL_PAGE_TITLE;
}

export function getFryerOilFilePrefix(): string {
  return "fryer-oil-journal";
}

// Formatting utilities
/** Пустое время (обе части null) — пустая строка, а не «00:00». */
export function formatTime(hour: number | null, minute: number | null): string {
  if (hour === null && minute === null) return "";
  return `${String(hour ?? 0).padStart(2, "0")}:${String(minute ?? 0).padStart(2, "0")}`;
}

/** Подпись оценки качества (1–5) или пусто, если оценки нет. */
export function formatQualityLabel(score: number | null): string {
  if (score === null) return "";
  return QUALITY_LABELS[score] || String(score);
}

export function formatDateRu(dateStr: string): string {
  if (!dateStr) return "";
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("ru-RU", { timeZone: "UTC" });
}
