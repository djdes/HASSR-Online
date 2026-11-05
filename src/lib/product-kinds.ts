/**
 * Вид продукции, срок годности и условия хранения в справочнике продуктов
 * (задача руководителя 05.11.2026, п. 5).
 *
 * Вид: продукты (сырьё) / полуфабрикаты собственного производства / готовая
 * продукция. Старые записи без вида — сырьё (`Product.kind @default("raw")`):
 * справочник до сих пор заполняли для приёмки и входного контроля.
 *
 * Срок годности хранится одним из двух полей: `shelfLifeDays` (сутки) или
 * `shelfLifeHours` (часы) — у блюд и полуфабрикатов срок обычно в часах
 * («12 ч»), у сырья — в сутках. Модуль client-safe: без БД.
 */

export const PRODUCT_KINDS = ["raw", "semi", "finished"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export const DEFAULT_PRODUCT_KIND: ProductKind = "raw";

export function isProductKind(value: unknown): value is ProductKind {
  return typeof value === "string" && (PRODUCT_KINDS as readonly string[]).includes(value);
}

/** Вид из базы: неизвестное или пустое значение — сырьё. */
export function productKindOf(value: unknown): ProductKind {
  return isProductKind(value) ? value : DEFAULT_PRODUCT_KIND;
}

/**
 * Вид из колонки файла импорта: «Сырьё», «Продукт», «Полуфабрикат», «П/Ф»,
 * «Готовая продукция», «Блюдо», а также коды raw / semi / finished.
 * Не распознали — null (вызывающий берёт вид по умолчанию).
 */
export function parseProductKindText(value: unknown): ProductKind | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
  if (!text) return null;
  if (isProductKind(text)) return text;
  if (/полуфабрик|^п\s*\/\s*ф|^пф$|semi/.test(text)) return "semi";
  if (/готов|блюд|издели|finished|dish/.test(text)) return "finished";
  if (/сырь|сырье|продукт|товар|raw/.test(text)) return "raw";
  return null;
}

export const SERVING_TEMPS = ["hot", "soup", "cold"] as const;
export type ServingTemp = (typeof SERVING_TEMPS)[number];

export function isServingTemp(value: unknown): value is ServingTemp {
  return typeof value === "string" && (SERVING_TEMPS as readonly string[]).includes(value);
}

export type ShelfLifeUnit = "hours" | "days";
export type ShelfLife = { value: number; unit: ShelfLifeUnit };

/** Срок из полей записи: часы, если заданы, иначе сутки; нет — null. */
export function productShelfLife(product: { shelfLifeDays?: number | null; shelfLifeHours?: number | null }): ShelfLife | null {
  if (product.shelfLifeHours != null && product.shelfLifeHours > 0) return { value: product.shelfLifeHours, unit: "hours" };
  if (product.shelfLifeDays != null && product.shelfLifeDays > 0) return { value: product.shelfLifeDays, unit: "days" };
  return null;
}

/** Срок в часах — для этикеток и расчёта «годен до». */
export function productShelfLifeHours(product: { shelfLifeDays?: number | null; shelfLifeHours?: number | null }): number | null {
  const shelf = productShelfLife(product);
  if (!shelf) return null;
  return shelf.unit === "hours" ? shelf.value : shelf.value * 24;
}

const SHELF_MAX = { hours: 24 * 366, days: 3650 } as const;

/**
 * Поля записи из ввода «значение + единица». Пустое значение — срок не
 * задан. Не целое, не положительное или слишком большое — ошибка.
 */
export function shelfLifeFields(
  rawValue: unknown,
  rawUnit: unknown,
): { ok: true; shelfLifeDays: number | null; shelfLifeHours: number | null } | { ok: false } {
  const unit: ShelfLifeUnit = rawUnit === "hours" ? "hours" : "days";
  if (rawValue === null || rawValue === undefined || rawValue === "") return { ok: true, shelfLifeDays: null, shelfLifeHours: null };
  const value = typeof rawValue === "number" ? rawValue : Number(String(rawValue).trim().replace(",", "."));
  if (!Number.isInteger(value) || value <= 0 || value > SHELF_MAX[unit]) return { ok: false };
  return unit === "hours" ? { ok: true, shelfLifeDays: null, shelfLifeHours: value } : { ok: true, shelfLifeDays: value, shelfLifeHours: null };
}

/**
 * Срок из ячейки импорта: «30» (сутки), «72 ч», «12 часов», «3 сут»,
 * «5 дней», «2 мес» (30 сут в месяце). Колонка «…, ч» — `hoursColumn`.
 */
export function parseShelfLifeText(value: unknown, hoursColumn = false): ShelfLife | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLocaleLowerCase("ru");
  const match = /^(\d+)(?:[.,]\d+)?\s*(.*)$/.exec(text);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount <= 0) return null;
  const unit = match[2].replace(/\.$/, "").trim();
  let shelf: ShelfLife;
  if (/^(ч|час|часа|часов|h|hours?)$/.test(unit)) shelf = { value: amount, unit: "hours" };
  else if (/^(мес|месяц|месяца|месяцев)$/.test(unit)) shelf = { value: amount * 30, unit: "days" };
  else if (unit === "") shelf = { value: amount, unit: hoursColumn ? "hours" : "days" };
  else if (/^(д|дн|день|дня|дней|сут|сутки|суток|d|days?)$/.test(unit)) shelf = { value: amount, unit: "days" };
  else return null;
  return shelf.value <= SHELF_MAX[shelf.unit] ? shelf : null;
}

/**
 * Ячейка «Условия хранения» из файла: температурный режим («+2…+6 °C»,
 * «не выше −18») — в режим, слова — в условие.
 */
export function looksLikeStorageTemperature(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 40) return false;
  return /\d/.test(text) && /°|º|℃|\bc\b|[+−-]\s*\d|град/i.test(text);
}
