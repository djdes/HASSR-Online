import {
  buildDateKeys,
  coerceUtcDate,
  formatMonthLabel,
  isWeekend,
  toDateKey,
} from "@/lib/hygiene-document";
import { normalizeReadingPhotos, withReadingPhoto } from "@/lib/reading-photos";

export const COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE = "cold_equipment_control";
/** Название журнала — по форме Приложения № 2 к СанПиН 2.3/2.4.4282-26 (`COLD_EQUIPMENT_LEGAL_BASIS`). */
export const COLD_EQUIPMENT_DOCUMENT_TITLE =
  "Журнал учёта температурного режима холодильного и морозильного оборудования";

/**
 * Основание формы: печатается мелко по центру под названием на первой
 * странице PDF и стоит в «На основании» на странице журнала на сайте.
 */
export const COLD_EQUIPMENT_LEGAL_BASIS = "Приложение № 2 к СанПиН 2.3/2.4.4282-26";

type EquipmentSeed = {
  name: string;
  min: number | null;
  max: number | null;
};

const DEFAULT_EQUIPMENT_SEEDS: EquipmentSeed[] = [
  { name: "Холодильная камера", min: 2, max: 4 },
  { name: "Морозильный ларь", min: -20, max: -18 },
  { name: "Холодильник плюсовой", min: -2, max: 2 },
  { name: "Винный шкаф", min: 6, max: 12 },
  { name: "Икорный холодильник", min: -4, max: -2 },
  { name: "Охлаждаемая витрина", min: 0, max: 2 },
  { name: "Холодильник для масла", min: -6, max: -3 },
  { name: "Витрина", min: 2, max: 6 },
];

export type ColdEquipmentConfigItem = {
  id: string;
  sourceEquipmentId: string | null;
  name: string;
  min: number | null;
  max: number | null;
  /** Сколько раз в день снимают показания у ЭТОГО оборудования. */
  readingMode?: ColdEquipmentReadingModeId;
};

/**
 * Типовое холодильное оборудование с нормами по СанПиН.
 *
 * Нужен затем, что раньше диалог просил вписать «Температуру от» и
 * «до» руками — а повар этих цифр не знает и вписывал наугад. Норма
 * должна приходить вместе с выбором типа, как в бумажных методичках:
 * человек выбирает «Морозильное», а не вспоминает, что там −18.
 */
export type ColdEquipmentPreset = {
  id: string;
  label: string;
  min: number | null;
  max: number | null;
  /** Короткая расшифровка нормы под названием. */
  hint: string;
};

export const COLD_EQUIPMENT_PRESETS: ColdEquipmentPreset[] = [
  {
    id: "fridge",
    label: "Холодильное",
    min: 2,
    max: 6,
    hint: "от +2 °C до +6 °C",
  },
  {
    id: "freezer",
    label: "Морозильное",
    min: null,
    max: -18,
    hint: "−18 °C и ниже",
  },
  {
    id: "poultry",
    label: "Холодильное для птицы",
    min: -2,
    max: 2,
    hint: "от −2 °C до +2 °C",
  },
  {
    id: "drinks",
    label: "Холодильное для напитков",
    min: 5,
    max: 20,
    hint: "от +5 °C до +20 °C",
  },
  {
    id: "butter",
    label: "Холодильное для масла",
    min: -6,
    max: -3,
    hint: "от −6 °C до −3 °C",
  },
  {
    id: "fridge-wide",
    label: "Холодильное (расширенный диапазон)",
    min: 2,
    max: 10,
    hint: "от +2 °C до +10 °C",
  },
  {
    id: "caviar",
    label: "Икорная витрина",
    min: -4,
    max: -2,
    hint: "от −4 °C до −2 °C",
  },
  {
    id: "display",
    label: "Охлаждаемая витрина",
    min: 0,
    max: 2,
    hint: "от 0 °C до +2 °C",
  },
  {
    id: "custom",
    label: "Другое — задать вручную",
    min: null,
    max: null,
    hint: "нормы вводятся сами",
  },
];

/** Сколько раз в день снимают показания. Влияет на число строк в бланке. */
export const COLD_EQUIPMENT_READING_MODES = [
  { id: "once", label: "1 раз в день", times: 1 },
  { id: "twice", label: "2 раза в день", times: 2 },
  { id: "thrice", label: "3 раза в день", times: 3 },
] as const;

export type ColdEquipmentReadingModeId =
  (typeof COLD_EQUIPMENT_READING_MODES)[number]["id"];

/** Сколько замеров в день у оборудования (1–3). */
export function getColdEquipmentReadingCount(item: { readingMode?: ColdEquipmentReadingModeId }): number {
  return COLD_EQUIPMENT_READING_MODES.find((mode) => mode.id === item.readingMode)?.times ?? 1;
}

/**
 * Ключ замера в `temperatures`. Первый замер живёт под id оборудования —
 * так читаются все старые документы, QR и TasksFlow; второй и третий — под
 * `id#2`, `id#3`. Модель данных строки при этом не меняется.
 */
export function coldReadingSlotKey(equipmentId: string, slotIndex: number): string {
  return slotIndex <= 0 ? equipmentId : `${equipmentId}#${slotIndex + 1}`;
}

/** Строка сетки: оборудование × номер замера за день. */
export type ColdEquipmentReadingSlot = ColdEquipmentConfigItem & {
  /** Ключ значения в `temperatures` и `corrections`. */
  slotKey: string;
  slotIndex: number;
  slotCount: number;
  /** «1-й замер» / «2-й замер»; пусто, когда замер один. */
  slotLabel: string;
};

/** Оборудование документа, развёрнутое по замерам в день. */
export function expandColdEquipmentReadingSlots(
  config: Pick<ColdEquipmentDocumentConfig, "equipment">
): ColdEquipmentReadingSlot[] {
  return config.equipment.flatMap((item) => {
    const slotCount = getColdEquipmentReadingCount(item);
    return Array.from({ length: slotCount }, (_, slotIndex) => ({
      ...item,
      slotKey: coldReadingSlotKey(item.id, slotIndex),
      slotIndex,
      slotCount,
      slotLabel: slotCount > 1 ? `${slotIndex + 1}-й замер` : "",
    }));
  });
}

/** Ключ первого пустого замера оборудования за день; все заполнены — последний. */
export function pickColdReadingSlotForWrite(
  item: ColdEquipmentConfigItem,
  temperatures: Record<string, number | null | undefined>,
  /** Замеры с отметкой «обсл»/«рем» тоже заняты. */
  statuses: Record<string, ColdEquipmentStatus | undefined> = {}
): string {
  const count = getColdEquipmentReadingCount(item);
  for (let index = 0; index < count; index += 1) {
    const key = coldReadingSlotKey(item.id, index);
    if ((temperatures[key] === null || temperatures[key] === undefined) && !statuses[key]) return key;
  }
  return coldReadingSlotKey(item.id, count - 1);
}

export type ColdEquipmentDocumentConfig = {
  equipment: ColdEquipmentConfigItem[];
  skipWeekends: boolean;
};

export type ColdEquipmentEntryData = {
  responsibleTitle: string | null;
  temperatures: Record<string, number | null>;
  /**
   * Комментарии к отклонениям: что сделали, когда температура вышла за
   * норму. Ключ — id оборудования: у каждого холодильника своя история.
   */
  corrections?: Record<string, string>;
  /**
   * «обсл» / «рем» вместо температуры (2026-09-25): холодильник на
   * обслуживании или в ремонте — замера нет, норма не проверяется. Ключ —
   * тот же ключ замера, что в `temperatures`; температура там при этом `null`,
   * так что отчёты и автозаполнение, читающие только числа, работают как раньше.
   */
  statuses?: Record<string, ColdEquipmentStatus>;
  /**
   * Фото замера (2026-09-26): снимок дисплея из QR-формы — ссылка
   * `/uploads/readings/…` под тем же ключом замера, что в `temperatures`.
   * Показывается в документе рядом со значением. См. `reading-photos.ts`.
   */
  readingPhotos?: Record<string, string>;
};

/** Отметка вместо температуры: обслуживание или ремонт. */
export type ColdEquipmentStatus = "service" | "repair";

export const COLD_EQUIPMENT_STATUSES: ColdEquipmentStatus[] = ["service", "repair"];

/** Короткая запись в ячейке журнала и в печати. */
export const COLD_EQUIPMENT_STATUS_SHORT: Record<ColdEquipmentStatus, string> = {
  service: "обсл",
  repair: "рем",
};

/** Полное название — кнопки QR-формы и меню ячейки. */
export const COLD_EQUIPMENT_STATUS_TITLE: Record<ColdEquipmentStatus, string> = {
  service: "Обслуживание",
  repair: "Ремонт",
};

/**
 * «обсл», «обсл.», «Обслуживание», «service», «рем», «ремонт», «repair» →
 * отметка; всё остальное — `null`.
 */
export function parseColdEquipmentStatus(value: unknown): ColdEquipmentStatus | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase().replace(/\.$/, "");
  if (!text) return null;
  if (text === "service" || text.startsWith("обсл")) return "service";
  if (text === "repair" || text.startsWith("рем")) return "repair";
  return null;
}

/**
 * Текст из ячейки на сайте: число (с запятой или точкой) или «обсл»/«рем».
 * Пустое и мусор — пустая ячейка.
 */
export function parseColdEquipmentCellInput(raw: string): {
  temperature: number | null;
  status: ColdEquipmentStatus | null;
} {
  const status = parseColdEquipmentStatus(raw);
  if (status) return { temperature: null, status };
  const text = raw.trim().replace(",", ".");
  if (!text) return { temperature: null, status: null };
  const parsed = Number(text);
  return { temperature: Number.isFinite(parsed) ? parsed : null, status: null };
}

/** Что показать в ячейке: «обсл»/«рем» или число (пусто — пустая строка). */
export function formatColdEquipmentCell(
  temperature: number | null | undefined,
  status: ColdEquipmentStatus | null | undefined,
): string {
  if (status) return COLD_EQUIPMENT_STATUS_SHORT[status];
  return temperature === null || temperature === undefined ? "" : String(temperature);
}

/**
 * Записать в замер отметку «обсл»/«рем» (температура становится пустой) или
 * снять её (`null`). Комментарий к отклонению у этого замера больше не нужен.
 */
export function setColdEquipmentSlotStatus(
  data: ColdEquipmentEntryData,
  slotKey: string,
  status: ColdEquipmentStatus | null,
): ColdEquipmentEntryData {
  const statuses = { ...(data.statuses ?? {}) };
  if (status) statuses[slotKey] = status;
  else delete statuses[slotKey];
  const next: ColdEquipmentEntryData = {
    ...data,
    temperatures: status ? { ...data.temperatures, [slotKey]: null } : data.temperatures,
  };
  if (Object.keys(statuses).length > 0) next.statuses = statuses;
  else delete next.statuses;
  return next;
}

/**
 * Без отметок «обсл»/«рем»: обслуживание и ремонт — событие своего дня,
 * «как вчера» и перенос значений на следующий день их не копируют.
 */
export function withoutColdEquipmentStatuses(data: ColdEquipmentEntryData): ColdEquipmentEntryData {
  if (!data.statuses) return data;
  const next = { ...data };
  delete next.statuses;
  return next;
}

export type ColdEquipmentDeviation = {
  key: string;
  rowId: string;
  date: string;
  equipmentId: string;
  equipmentName: string;
  value: number;
  min: number | null;
  max: number | null;
  comment: string;
};

/** Значение вне нормы. Пустая ячейка отклонением не считается — её просто не заполнили. */
export function isColdEquipmentValueOutOfRange(
  value: number | null | undefined,
  item: { min: number | null; max: number | null },
): boolean {
  if (value === null || value === undefined) return false;
  if (item.min !== null && value < item.min) return true;
  if (item.max !== null && value > item.max) return true;
  return false;
}

/**
 * Отклонения документа — считаются из тех же строк, что и таблица.
 *
 * Именно из строк, а не из отдельного хранилища: поэтому исправленная
 * температура убирает запись из корректирующих действий сразу, без
 * перезагрузки, а заново вышедшая за норму возвращает её обратно.
 */
export function collectColdEquipmentDeviations(
  config: ColdEquipmentDocumentConfig,
  rows: Array<{ id: string; date: string; data: ColdEquipmentEntryData }>,
): ColdEquipmentDeviation[] {
  const result: ColdEquipmentDeviation[] = [];

  const slots = expandColdEquipmentReadingSlots(config);
  for (const row of rows) {
    for (const slot of slots) {
      const value = row.data.temperatures?.[slot.slotKey];
      if (!isColdEquipmentValueOutOfRange(value, slot)) continue;
      result.push({
        key: `${row.id}:${slot.slotKey}`,
        rowId: row.id,
        date: row.date,
        // Ключ замера: комментарий к отклонению держится за свой замер.
        equipmentId: slot.slotKey,
        equipmentName: slot.slotLabel ? `${slot.name} · ${slot.slotLabel}` : slot.name,
        value: value as number,
        min: slot.min,
        max: slot.max,
        comment: row.data.corrections?.[slot.slotKey] ?? "",
      });
    }
  }

  return result;
}

type EquipmentSource = {
  id: string;
  name: string;
  type?: string | null;
  tempMin?: number | null;
  tempMax?: number | null;
};

function createId(prefix: string) {
  const randomPart =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return `${prefix}-${randomPart}`;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function createColdEquipmentConfigItem(
  overrides: Partial<ColdEquipmentConfigItem> = {}
): ColdEquipmentConfigItem {
  return {
    id: overrides.id || createId("cold-equipment"),
    sourceEquipmentId: overrides.sourceEquipmentId || null,
    name: overrides.name?.trim() || "Холодильное оборудование",
    min: normalizeNumber(overrides.min),
    max: normalizeNumber(overrides.max),
    readingMode: overrides.readingMode ?? "once",
  };
}

function buildDefaultSeedItems() {
  // ВАЖНО: id должен быть детерминистским (на основе индекса), а не
  // случайный UUID. Иначе при пустом config документа `getTaskForm()`
  // возвращает поля с одним набором id, а валидатор сабмита (тоже
  // зовёт `getTaskForm()`) — со совершенно другим набором, и
  // worker'у приходит «expected number, received undefined» на каждое
  // поле, потому что shape-keys не совпадают с values-keys.
  return DEFAULT_EQUIPMENT_SEEDS.map((item, idx) =>
    createColdEquipmentConfigItem({
      id: `cold-equipment-default-${idx}`,
      name: item.name,
      min: item.min,
      max: item.max,
    })
  );
}

/**
 * Конфиг документа по оборудованию организации. Холодильников нет —
 * таблица пустая (в ней есть «Добавить холодильник»). Стоковые позиции
 * («Икорный холодильник», «Винный шкаф»…) подставляются только образцу
 * демо-организации: `sampleFallback: true`.
 */
export function buildColdEquipmentConfigFromEquipment(
  equipment: EquipmentSource[],
  options: { sampleFallback?: boolean } = {}
): ColdEquipmentDocumentConfig {
  const relevantEquipment = equipment.filter((item) => {
    const normalizedType = item.type?.toLowerCase();
    const looksColdType =
      normalizedType === "refrigerator" || normalizedType === "freezer";

    return looksColdType || item.tempMin != null || item.tempMax != null;
  });

  const configItems =
    relevantEquipment.length > 0
      ? relevantEquipment.map((item) =>
          createColdEquipmentConfigItem({
            sourceEquipmentId: item.id,
            name: item.name,
            min: item.tempMin ?? null,
            max: item.tempMax ?? null,
          })
        )
      : options.sampleFallback
        ? buildDefaultSeedItems()
        : [];

  return {
    equipment: configItems,
    skipWeekends: false,
  };
}

/** Конфиг нового документа без оборудования: пустая таблица. */
export function getDefaultColdEquipmentDocumentConfig(): ColdEquipmentDocumentConfig {
  return {
    equipment: [],
    skipWeekends: false,
  };
}

/** Образец для демо-организации и витрины: стоковый набор холодильников. */
export function getColdEquipmentSampleConfig(): ColdEquipmentDocumentConfig {
  return {
    equipment: buildDefaultSeedItems(),
    skipWeekends: false,
  };
}

export function normalizeColdEquipmentDocumentConfig(
  value: unknown
): ColdEquipmentDocumentConfig {
  // Документы, созданные до появления справочника, хранят показания под
  // id стоковых позиций (`cold-equipment-default-N`) и ключа `equipment`
  // в конфиге у них нет. Им стоковый набор оставляем — иначе пропадут их
  // записи. Новый документ всегда пишет `equipment` (хотя бы пустой).
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return getColdEquipmentSampleConfig();
  }

  const record = value as Record<string, unknown>;
  const equipment = Array.isArray(record.equipment)
    ? record.equipment
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const itemRecord = item as Record<string, unknown>;

          return createColdEquipmentConfigItem({
            id:
              typeof itemRecord.id === "string" && itemRecord.id.trim() !== ""
                ? itemRecord.id
                : undefined,
            sourceEquipmentId:
              typeof itemRecord.sourceEquipmentId === "string" &&
              itemRecord.sourceEquipmentId.trim() !== ""
                ? itemRecord.sourceEquipmentId
                : null,
            name:
              typeof itemRecord.name === "string" ? itemRecord.name : undefined,
            min: normalizeNumber(itemRecord.min),
            max: normalizeNumber(itemRecord.max),
            // Режим замеров раньше терялся при нормализации: диалог его
            // сохранял, а после перезагрузки страницы стоял «один раз».
            readingMode:
              itemRecord.readingMode === "once" ||
              itemRecord.readingMode === "twice" ||
              itemRecord.readingMode === "thrice"
                ? itemRecord.readingMode
                : undefined,
          });
        })
        .filter((item): item is ColdEquipmentConfigItem => item !== null)
    : [];

  return {
    equipment:
      equipment.length > 0 || Array.isArray(record.equipment)
        ? equipment
        : getColdEquipmentSampleConfig().equipment,
    skipWeekends:
      typeof record.skipWeekends === "boolean" ? record.skipWeekends : false,
  };
}

/**
 * Подставляет новую норму из справочника «Оборудование» в конфиг документа.
 *
 * ПОЧЕМУ нужно: строка журнала помнит `sourceEquipmentId`, но `min`/`max`
 * в ней заморожены на момент создания документа. Управляющая правила
 * норму в карточке холодильника, а журнал продолжал считать отклонением
 * то, что уже в норме (и наоборот). Имя из справочника подтягивалось,
 * а цифры — нет.
 *
 * Уже внесённые замеры не трогаем: пересчёт отклонений происходит при
 * показе, по текущему конфигу.
 *
 * @returns новый конфиг и флаг «что-то поменялось» (иначе запись в БД
 *          не нужна).
 */
export function applyEquipmentNormToColdConfig(
  config: ColdEquipmentDocumentConfig,
  norm: {
    sourceEquipmentId: string;
    min: number | null;
    max: number | null;
  }
): { config: ColdEquipmentDocumentConfig; changed: boolean } {
  const targetId = norm.sourceEquipmentId.trim();
  if (targetId === "") return { config, changed: false };

  let changed = false;
  const equipment = config.equipment.map((item) => {
    if (item.sourceEquipmentId !== targetId) return item;
    const nextMin = normalizeNumber(norm.min);
    const nextMax = normalizeNumber(norm.max);
    if (item.min === nextMin && item.max === nextMax) return item;
    changed = true;
    return { ...item, min: nextMin, max: nextMax };
  });

  return changed ? { config: { ...config, equipment }, changed } : { config, changed };
}

export function createEmptyColdEquipmentEntryData(
  config: ColdEquipmentDocumentConfig,
  responsibleTitle: string | null = null
): ColdEquipmentEntryData {
  const temperatures: Record<string, number | null> = {};

  expandColdEquipmentReadingSlots(config).forEach((slot) => {
    temperatures[slot.slotKey] = null;
  });

  return {
    responsibleTitle,
    temperatures,
  };
}

export function normalizeColdEquipmentEntryData(
  value: unknown
): ColdEquipmentEntryData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      responsibleTitle: null,
      temperatures: {},
    };
  }

  const record = value as Record<string, unknown>;
  const temperatureValues = record.temperatures;
  const temperatures: Record<string, number | null> = {};

  if (
    temperatureValues &&
    typeof temperatureValues === "object" &&
    !Array.isArray(temperatureValues)
  ) {
    Object.entries(temperatureValues as Record<string, unknown>).forEach(
      ([key, itemValue]) => {
        temperatures[key] = normalizeNumber(itemValue);
      }
    );
  }

  const corrections = normalizeCorrections(record.corrections);
  const statuses = normalizeStatuses(record.statuses);
  // Отметка сильнее числа: у замера «обсл»/«рем» температуры нет.
  if (statuses) for (const key of Object.keys(statuses)) temperatures[key] = null;
  const readingPhotos = normalizeReadingPhotos(record.readingPhotos);

  return {
    responsibleTitle:
      typeof record.responsibleTitle === "string" ? record.responsibleTitle : null,
    temperatures,
    ...(corrections ? { corrections } : {}),
    ...(statuses ? { statuses } : {}),
    ...(readingPhotos ? { readingPhotos } : {}),
  };
}

/**
 * Фото к замеру (снимок дисплея из QR-формы). Новое фото заменяет прежнее;
 * без ссылки запись не меняется — повторное сохранение без снимка не
 * стирает доказательство.
 */
export function setColdEquipmentSlotPhoto(
  data: ColdEquipmentEntryData,
  slotKey: string,
  url: string | null | undefined
): ColdEquipmentEntryData {
  const readingPhotos = withReadingPhoto(data.readingPhotos, slotKey, url);
  if (readingPhotos === data.readingPhotos) return data;
  return { ...data, ...(readingPhotos ? { readingPhotos } : {}) };
}

function normalizeStatuses(value: unknown): Record<string, ColdEquipmentStatus> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const statuses: Record<string, ColdEquipmentStatus> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const status = parseColdEquipmentStatus(raw);
    if (status) statuses[key] = status;
  }
  return Object.keys(statuses).length ? statuses : undefined;
}

/**
 * Комментарии к отклонениям проходят через normalize/sync/merge без потерь:
 * иначе ночной автозаполнитель и перезагрузка страницы стирали бы то, что
 * человек написал в «Корректирующих действиях».
 */
function normalizeCorrections(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const corrections: Record<string, string> = {};
  for (const [key, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text === "string" && text.trim()) corrections[key] = text;
  }
  return Object.keys(corrections).length ? corrections : undefined;
}

/**
 * Комментарий «что сделали» к замеру вне нормы. Пишется в то же
 * `corrections[slotKey]`, откуда его читает `collectColdEquipmentDeviations`
 * — значит, он виден в журнале и в печати без правок клиента.
 *
 * Пустой текст ничего не стирает: замер, исправленный в журнале руками,
 * не должен терять уже написанное объяснение.
 */
export function setColdEquipmentCorrection(
  data: ColdEquipmentEntryData,
  slotKey: string,
  comment: string
): ColdEquipmentEntryData {
  const text = comment.trim();
  if (!text) return data;
  return {
    ...data,
    corrections: { ...(data.corrections ?? {}), [slotKey]: text },
  };
}

/**
 * Сколько внесённых замеров потеряется, если убрать эти слоты.
 * Нужно для подтверждений: удаление строки оборудования и уменьшение
 * режима «3 раза в день» → «1 раз» молча стирали значения за весь период.
 */
export function countColdEquipmentValues(
  entries: Array<{ data: { temperatures?: Record<string, number | null> } }>,
  slotKeys: string[]
): number {
  const keys = new Set(slotKeys);
  let total = 0;
  for (const entry of entries) {
    const temperatures = entry.data?.temperatures;
    if (!temperatures) continue;
    for (const key of keys) {
      if (typeof temperatures[key] === "number") total += 1;
    }
  }
  return total;
}

/** Ключи слотов оборудования при заданном режиме замеров. */
export function coldEquipmentSlotKeys(
  equipmentId: string,
  readingMode?: ColdEquipmentReadingModeId
): string[] {
  const count = getColdEquipmentReadingCount({ readingMode });
  return Array.from({ length: count }, (_, index) =>
    coldReadingSlotKey(equipmentId, index)
  );
}

export function syncColdEquipmentEntryDataWithConfig(
  entryData: ColdEquipmentEntryData,
  config: ColdEquipmentDocumentConfig
): ColdEquipmentEntryData {
  const next = createEmptyColdEquipmentEntryData(config, entryData.responsibleTitle);

  expandColdEquipmentReadingSlots(config).forEach((slot) => {
    next.temperatures[slot.slotKey] = entryData.temperatures[slot.slotKey] ?? null;
  });
  if (entryData.corrections) next.corrections = entryData.corrections;
  if (entryData.statuses) next.statuses = entryData.statuses;
  if (entryData.readingPhotos) next.readingPhotos = entryData.readingPhotos;

  return next;
}

function hashToUnit(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return (hash % 1000) / 999;
}

function buildGeneratedTemperature(
  min: number | null,
  max: number | null,
  seed: string
): number | null {
  if (min == null && max == null) return null;
  if (min != null && max == null) return min;
  if (min == null && max != null) return max;
  if (min === max) return min;

  const low = Math.min(min as number, max as number);
  const high = Math.max(min as number, max as number);
  const unit = hashToUnit(seed);
  return Math.round(low + (high - low) * unit);
}

export function buildColdEquipmentAutoFillEntryData(params: {
  config: ColdEquipmentDocumentConfig;
  dateKey: string;
  responsibleTitle: string | null;
}): ColdEquipmentEntryData {
  const { config, dateKey, responsibleTitle } = params;
  const data = createEmptyColdEquipmentEntryData(config, responsibleTitle);

  expandColdEquipmentReadingSlots(config).forEach((slot) => {
    data.temperatures[slot.slotKey] = buildGeneratedTemperature(
      slot.min,
      slot.max,
      `${dateKey}:${slot.slotKey}`
    );
  });

  return data;
}

export function mergeColdEquipmentEntryData(
  currentData: ColdEquipmentEntryData,
  generatedData: ColdEquipmentEntryData
): ColdEquipmentEntryData {
  const next: ColdEquipmentEntryData = {
    responsibleTitle: currentData.responsibleTitle || generatedData.responsibleTitle,
    temperatures: {},
  };

  Object.keys(generatedData.temperatures).forEach((equipmentId) => {
    // «обсл»/«рем» за этот день — число автозаполнение не подставляет.
    next.temperatures[equipmentId] = currentData.statuses?.[equipmentId]
      ? null
      : currentData.temperatures[equipmentId] ??
        generatedData.temperatures[equipmentId] ??
        null;
  });
  if (currentData.corrections) next.corrections = currentData.corrections;
  if (currentData.statuses) next.statuses = currentData.statuses;
  // Фото — только к своим замерам: из сгенерированных данных не берём.
  if (currentData.readingPhotos) next.readingPhotos = currentData.readingPhotos;

  return next;
}

export function buildColdEquipmentAutoFillRows(params: {
  config: ColdEquipmentDocumentConfig;
  dateFrom: Date | string;
  dateTo: Date | string;
  responsibleTitle: string | null;
  responsibleUserId: string;
}) {
  const { config, dateFrom, dateTo, responsibleTitle, responsibleUserId } = params;

  return buildDateKeys(dateFrom, dateTo)
    .filter((dateKey) => !(config.skipWeekends && isWeekend(dateKey)))
    .map((dateKey) => ({
      employeeId: responsibleUserId,
      date: new Date(dateKey),
      data: buildColdEquipmentAutoFillEntryData({
        config,
        dateKey,
        responsibleTitle,
      }),
    }));
}

export function getColdEquipmentDocumentTitle() {
  return COLD_EQUIPMENT_DOCUMENT_TITLE;
}

export function getColdEquipmentCreatePeriodBounds(referenceDate = new Date()) {
  const date = coerceUtcDate(referenceDate);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const currentDay = date.getUTCDate();
  const isFirstHalf = currentDay <= 15;

  return {
    dateFrom: `${year}-${String(month + 1).padStart(2, "0")}-${isFirstHalf ? "01" : "16"}`,
    dateTo: `${year}-${String(month + 1).padStart(2, "0")}-${String(isFirstHalf ? 15 : lastDay).padStart(2, "0")}`,
  };
}

/**
 * Подпись периода документа в СПИСКЕ. Документ холодильников — полумесячный
 * (`getColdEquipmentCreatePeriodBounds`: 1-15 или 16-конец месяца), поэтому
 * «Август 2026 г.» делал два документа одного месяца неразличимыми. Формат
 * эталона и нашего же журнала уборки: «Август с 1 по 15» (X4 аудита).
 * Для периодов, выходящих за один месяц, остаётся общий formatMonthLabel.
 */
export function getColdEquipmentPeriodLabel(
  dateFrom: Date | string,
  dateTo: Date | string
) {
  const start = coerceUtcDate(dateFrom);
  const end = coerceUtcDate(dateTo);

  if (
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth()
  ) {
    return `${COLD_EQUIPMENT_MONTH_NAMES[start.getUTCMonth()]} с ${start.getUTCDate()} по ${end.getUTCDate()}`;
  }

  return formatMonthLabel(dateFrom, dateTo);
}

const COLD_EQUIPMENT_MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

export function getColdEquipmentDateLabel(date: Date | string) {
  const dateKey = toDateKey(date);
  const [year, month, day] = dateKey.split("-");
  return `${day}.${month}.${year}`;
}

export function getColdEquipmentFilePrefix() {
  return "cold-equipment-journal";
}
