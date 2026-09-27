import { normalizeMenuTime } from "@/lib/finished-product-bulk";
import {
  VISION_FIELD_MAX,
  VISION_MAX_ITEMS,
  type VisionFieldKey,
  type VisionItemByKind,
  type VisionKind,
} from "@/lib/ai-vision/shared";

/**
 * Разбор ответа исполнителя «Распознать с фото».
 *
 * Модель просят «строго один JSON», но на деле ответ бывает обёрнут в
 * ```json, с фразой до или после, иногда — голым массивом. Поэтому:
 * снимаем фенсы, ищем первый JSON-объект/массив с учётом строк и скобок,
 * проверяем поля, обрезаем длины, выкидываем заглушки («нет», «null»,
 * «неразборчиво»), дубли и строки без букв, не больше 200 строк.
 *
 * Чистый модуль: без Node-зависимостей и без БД.
 */

export type ParsedVisionReply<K extends VisionKind> = {
  items: Array<VisionItemByKind[K]>;
  /** Строк было больше VISION_MAX_ITEMS — отдали первые. */
  truncated: boolean;
  /** В ответе нашёлся JSON со списком строк (пусть и пустым). */
  recognized: boolean;
};

/** Ответ длиннее — это уже не ответ на нашу инструкцию. */
const RAW_MAX_CHARS = 200_000;
/** Сколько раз пробуем начать разбор с очередной скобки. */
const MAX_SCAN_STARTS = 40;

const FENCE_RE = /```[a-zA-Z]*\s*([\s\S]*?)```/g;
const NUMBERING_RE = /^\s*(?:\d{1,3}[.)](?!\d)|[-–—•*·])\s*/;
const PLACEHOLDERS = new Set([
  "null",
  "none",
  "nil",
  "undefined",
  "n/a",
  "na",
  "-",
  "—",
  "–",
  "...",
  "…",
  "?",
  "нет",
  "нету",
  "не указано",
  "не указан",
  "не указана",
  "неизвестно",
  "неразборчиво",
  "не читается",
  "нечитаемо",
  "[нечитаемо]",
  "[неразборчиво]",
]);

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Строка или число → текст; всё остальное (объекты, null) — пусто. */
function asText(value: unknown): string {
  if (typeof value === "string") return collapse(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function isPlaceholder(text: string): boolean {
  return PLACEHOLDERS.has(text.toLowerCase());
}

function clip(field: VisionFieldKey, text: string): string {
  return text.slice(0, VISION_FIELD_MAX[field]).trim();
}

/** Первое непустое значение из синонимов ключа. */
function pick(entry: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (!(key in entry)) continue;
    const text = asText(entry[key]);
    if (text && !isPlaceholder(text)) return text;
  }
  return "";
}

/**
 * Наименование: без нумерации «1.»/«-», с буквами, без знаков сомнения.
 * «?» модель ставит, когда буквы не разобрала, — такую строку не берём.
 */
export function cleanVisionName(value: unknown): string {
  const text = collapse(asText(value).replace(NUMBERING_RE, ""));
  if (!text || isPlaceholder(text)) return "";
  if (!/\p{L}/u.test(text)) return "";
  if (text.includes("?") || text.includes("�")) return "";
  return clip("name", text);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Дата → «ГГГГ-ММ-ДД». Принимаем «2026-09-25», «2026.09.25», «25.09.2026»,
 * «25.09.26», «25/09/2026». Неполная или невозможная дата — пусто.
 */
export function normalizeVisionDate(value: unknown): string {
  const text = asText(value);
  if (!text) return "";
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(text);
  const ru = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})$/.exec(text);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (ru) {
    day = Number(ru[1]);
    month = Number(ru[2]);
    year = ru[3].length === 2 ? 2000 + Number(ru[3]) : Number(ru[3]);
  } else {
    return "";
  }
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeMenuEntry(entry: Record<string, unknown>): VisionItemByKind["menu"] | null {
  const name = cleanVisionName(pick(entry, ["name", "title", "dish", "наименование", "название"]));
  if (!name) return null;
  return {
    name,
    yield: clip("yield", pick(entry, ["yield", "portion", "weight", "output", "выход"])),
    time: normalizeMenuTime(pick(entry, ["time", "время"])),
  };
}

function normalizeRawEntry(entry: Record<string, unknown>): VisionItemByKind["raw"] | null {
  const name = cleanVisionName(pick(entry, ["name", "productName", "product", "title", "наименование", "название"]));
  if (!name) return null;
  let quantity = pick(entry, ["quantity", "qty", "amount", "количество"]);
  const unit = pick(entry, ["unit", "units", "единица"]);
  if (quantity && unit && !quantity.toLowerCase().includes(unit.toLowerCase())) quantity = `${quantity} ${unit}`;
  return {
    name,
    manufacturer: clip("manufacturer", pick(entry, ["manufacturer", "producer", "изготовитель", "производитель"])),
    supplier: clip("supplier", pick(entry, ["supplier", "vendor", "поставщик"])),
    quantity: clip("quantity", quantity),
    productionDate: normalizeVisionDate(pick(entry, ["productionDate", "manufactureDate", "production_date", "producedAt"])),
    expiryDate: normalizeVisionDate(pick(entry, ["expiryDate", "expirationDate", "expiry_date", "bestBefore", "useBy"])),
  };
}

function normalizeGenericEntry(entry: Record<string, unknown>): VisionItemByKind["generic"] | null {
  const name = cleanVisionName(pick(entry, ["name", "title", "наименование", "название"]));
  return name ? { name } : null;
}

function normalizeEntry<K extends VisionKind>(kind: K, raw: unknown): VisionItemByKind[K] | null {
  // Строка вместо объекта — это просто наименование.
  const entry: Record<string, unknown> | null =
    typeof raw === "string"
      ? { name: raw }
      : raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;
  if (!entry) return null;
  const item =
    kind === "menu" ? normalizeMenuEntry(entry) : kind === "raw" ? normalizeRawEntry(entry) : normalizeGenericEntry(entry);
  return item as VisionItemByKind[K] | null;
}

/** Конец JSON-значения, начатого скобкой в позиции start (строки и экранирование учтены). */
function matchBracket(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

function tryParse(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

/** Список строк из разобранного значения: `{"items":[…]}` или голый массив. */
function itemsOf(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: unknown[] }).items;
  }
  return null;
}

/**
 * Первое JSON-значение из ответа модели, которое принимает `accept`:
 * фенсы → весь текст → первый сбалансированный объект/массив.
 */
export function extractJsonValue<T>(raw: string, accept: (value: unknown) => T | null): T | null {
  const text = String(raw ?? "").slice(0, RAW_MAX_CHARS).trim();
  if (!text) return null;
  const candidates: string[] = [];
  for (const match of text.matchAll(FENCE_RE)) candidates.push(match[1].trim());
  candidates.push(text);
  for (const candidate of candidates) {
    const value = accept(tryParse(candidate));
    if (value !== null) return value;
  }
  let starts = 0;
  for (let i = 0; i < text.length && starts < MAX_SCAN_STARTS; i += 1) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") continue;
    starts += 1;
    const end = matchBracket(text, i);
    if (end < 0) continue;
    const value = accept(tryParse(text.slice(i, end + 1)));
    if (value !== null) return value;
  }
  return null;
}

/** Первый JSON со списком строк (`{"items":[…]}` или массив); null — не нашли. */
export function extractVisionItemsArray(raw: string): unknown[] | null {
  return extractJsonValue(raw, itemsOf);
}

export function parseVisionReply<K extends VisionKind>(raw: string, kind: K): ParsedVisionReply<K> {
  const entries = extractVisionItemsArray(raw);
  if (!entries) return { items: [], truncated: false, recognized: false };
  const seen = new Set<string>();
  const items: Array<VisionItemByKind[K]> = [];
  let truncated = false;
  for (const entry of entries) {
    const item = normalizeEntry(kind, entry);
    if (!item) continue;
    const key = JSON.stringify({ ...item, name: item.name.toLowerCase() });
    if (seen.has(key)) continue;
    seen.add(key);
    if (items.length >= VISION_MAX_ITEMS) {
      truncated = true;
      break;
    }
    items.push(item);
  }
  return { items, truncated, recognized: true };
}

/* ─────────── Этикетка продукта (`/api/ocr/label`, контракт PhotoCapture) ─────────── */

export type VisionLabelResult = {
  productName: string | null;
  supplier: string | null;
  manufactureDate: string | null;
  expiryDate: string | null;
  quantity: number | null;
  unit: "kg" | "l" | "pcs" | null;
  barcode: string | null;
  batchNumber: string | null;
  storageTemp: string | null;
  composition: string | null;
  confidence: "high" | "medium" | "low";
};

const LABEL_KEYS = ["productName", "supplier", "manufactureDate", "expiryDate", "barcode", "confidence"];

function labelObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return LABEL_KEYS.some((key) => key in (value as Record<string, unknown>)) ? (value as Record<string, unknown>) : null;
}

function labelText(value: unknown, max: number): string | null {
  const text = asText(value);
  if (!text || isPlaceholder(text)) return null;
  return text.slice(0, max).trim();
}

function labelQuantity(value: unknown): number | null {
  const number =
    typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".").replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(number) && number > 0 && number < 1_000_000 ? number : null;
}

/** Ответ по этикетке → поля формы; null — JSON этикетки в ответе нет. */
export function parseLabelReply(raw: string): VisionLabelResult | null {
  const entry = extractJsonValue(raw, labelObject);
  if (!entry) return null;
  const unit = asText(entry.unit).toLowerCase();
  const confidence = asText(entry.confidence).toLowerCase();
  return {
    productName: cleanVisionName(entry.productName) || null,
    supplier: labelText(entry.supplier, 200),
    manufactureDate: normalizeVisionDate(entry.manufactureDate) || null,
    expiryDate: normalizeVisionDate(entry.expiryDate) || null,
    quantity: labelQuantity(entry.quantity),
    unit: unit === "kg" || unit === "l" || unit === "pcs" ? unit : null,
    barcode: labelText(entry.barcode, 64),
    batchNumber: labelText(entry.batchNumber, 64),
    storageTemp: labelText(entry.storageTemp, 120),
    composition: labelText(entry.composition, 500),
    confidence: confidence === "high" || confidence === "medium" ? confidence : "low",
  };
}

/* ─────────── Показание дисплея (`/api/ocr/reading`, контракт DisplayOcrButton) ─────────── */

/** Тип прибора из ответа: цифровой дисплей, стрелочный, стеклянный жидкостный, другое. */
export type ReadingDevice = "digital" | "dial" | "liquid" | "other";

export type VisionReadingResult = {
  value: number | null;
  unit: "C" | "%" | "h" | null;
  confidence: "high" | "medium" | "low";
  /** Есть, только если модель назвала тип прибора (инструкция с 2026-09-27). */
  device?: ReadingDevice;
};

function normalizeReadingDevice(value: unknown): ReadingDevice | null {
  const text = asText(value).toLowerCase();
  return text === "digital" || text === "dial" || text === "liquid" || text === "other" ? text : null;
}

/** Стрелочный и жидкостный термометр читаются по шкале — точнее градуса не бывает. */
export function isAnalogReadingDevice(device: ReadingDevice | null | undefined): boolean {
  return device === "dial" || device === "liquid";
}

/**
 * Модель сама записала в `seen`, что сомневается: «−26 или −23»,
 * «средняя цифра читается неоднозначно», «не уверен», «?». Такое число не
 * подставляем, даже если оно пришло в `value`, — проверено на настоящей
 * модели: при сомнении она иногда всё равно выбирает вариант. Лучше
 * «Не разобрали цифры — введите вручную», чем чужое число в журнале.
 */
export function isHedgedReadingNote(seen: unknown): boolean {
  const text = asText(seen).toLowerCase();
  if (!text) return false;
  return /(^|[^а-яё])или([^а-яё]|$)|неоднозначн|сомнева|сомнени|не\s*уверен|\?/.test(text);
}

function readingObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  return "value" in entry || "confidence" in entry ? entry : null;
}

/**
 * Число с дисплея: число как есть; строку — только если это одно число
 * («-18.5», «−18,5», «+4»). «18?», «-1_», «около 5» — null: угадывать
 * цифры и знак нельзя.
 */
export function normalizeReadingValue(value: unknown): number | null {
  let number: number;
  if (typeof value === "number") {
    number = value;
  } else if (typeof value === "string") {
    const text = value.replace(/\s+/g, "").replace(/[−–—]/g, "-").replace(",", ".");
    if (!/^[-+]?\d+(?:\.\d+)?$/.test(text)) return null;
    number = Number(text);
  } else {
    return null;
  }
  return Number.isFinite(number) && Math.abs(number) < 1_000_000 ? number : null;
}

function normalizeReadingUnit(value: unknown): VisionReadingResult["unit"] {
  const text = asText(value).toLowerCase().replace(/[°\s]/g, "");
  if (text === "c" || text === "с" || text === "celsius") return "C";
  if (text === "%" || text === "rh" || text === "%rh") return "%";
  if (text === "h" || text === "ч" || text === "hours") return "h";
  return null;
}

/**
 * «Что видно на приборе» (`seen`) из ответа — только для журнала сервера:
 * по нему разбирают промахи распознавания. Клиенту не отдаётся.
 */
export function parseReadingSeen(raw: string): string | null {
  const entry = extractJsonValue(raw, readingObject);
  const seen = entry ? asText(entry.seen).slice(0, 160) : "";
  return seen || null;
}

/**
 * Ответ по прибору → { value, unit, confidence, device? }; null — JSON
 * показания в ответе нет.
 *
 * Стрелочный и жидкостный термометр (`device`: dial / liquid) сайт сам
 * округляет до целого градуса и не верит в «high»: по шкале точнее не
 * прочитать, а пометка «с фото — проверьте» должна звучать честно — модель
 * об этом просят в инструкции, но на её слово не полагаемся. Сомнение,
 * записанное в `seen` («−26 или −23»), — value: null (`isHedgedReadingNote`).
 */
export function parseReadingReply(raw: string): VisionReadingResult | null {
  const entry = extractJsonValue(raw, readingObject);
  if (!entry) return null;
  const device = normalizeReadingDevice(entry.device);
  let value = isHedgedReadingNote(entry.seen) ? null : normalizeReadingValue(entry.value);
  const confidenceText = asText(entry.confidence).toLowerCase();
  let confidence: VisionReadingResult["confidence"] =
    value !== null && (confidenceText === "high" || confidenceText === "medium") ? confidenceText : "low";
  if (value !== null && isAnalogReadingDevice(device)) {
    // Половинки — от нуля в обе стороны: −18.5 → −19, как 18.5 → 19.
    const rounded = Math.sign(value) * Math.round(Math.abs(value));
    value = Object.is(rounded, -0) ? 0 : rounded;
    if (confidence === "high") confidence = "medium";
  }
  return {
    value,
    unit: value === null ? null : normalizeReadingUnit(entry.unit),
    confidence,
    ...(device ? { device } : {}),
  };
}

/* ─────────── Проверка фото-доказательства (`/api/ai/check-photo`) ─────────── */

export const PHOTO_CHECK_KINDS = ["food", "equipment", "document", "blur", "finger", "dark", "other"] as const;

export type VisionPhotoCheckResult = {
  valid: boolean;
  confidence: number;
  kind: (typeof PHOTO_CHECK_KINDS)[number];
  reason: string;
};

function photoCheckObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return "valid" in (value as Record<string, unknown>) ? (value as Record<string, unknown>) : null;
}

/**
 * Ответ по фото → { valid, confidence, kind, reason }; null — JSON оценки в
 * ответе нет. valid — только явное true: «может быть», пусто и мусор — не
 * годится; confidence приводится к 0…1.
 */
export function parsePhotoCheckReply(raw: string): VisionPhotoCheckResult | null {
  const entry = extractJsonValue(raw, photoCheckObject);
  if (!entry) return null;
  const valid = entry.valid === true || (typeof entry.valid === "string" && entry.valid.trim().toLowerCase() === "true");
  const confidenceRaw = typeof entry.confidence === "number" ? entry.confidence : Number(asText(entry.confidence).replace(",", "."));
  const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0;
  const kind = asText(entry.kind).toLowerCase();
  return {
    valid,
    confidence: Math.round(confidence * 100) / 100,
    kind: (PHOTO_CHECK_KINDS as readonly string[]).includes(kind) ? (kind as VisionPhotoCheckResult["kind"]) : "other",
    reason: asText(entry.reason).slice(0, 300),
  };
}
