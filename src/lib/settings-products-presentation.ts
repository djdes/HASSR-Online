import type { Locale } from "@/i18n/locales";

const UNIT_KEYS = {
  kg: "units.kg", g: "units.g", l: "units.l", ml: "units.ml",
  pcs: "units.pcs", pc: "units.pc", bottle: "units.bottle", pack: "units.pack",
} as const;
type UnitKey = (typeof UNIT_KEYS)[keyof typeof UNIT_KEYS];
type UnitCopy = (key: UnitKey) => string;
const PAGE_UNITS = new Set(["kg", "l", "pcs", "g", "ml", "pack"]);
const RUSSIAN_INPUT: Record<string, string> = {
  "кг": "kg", "г": "g", "л": "l", "мл": "ml", "шт": "pcs", "фл": "bottle", "уп": "pack",
};
const SELECTED_INPUT: Record<Locale, Record<string, string>> = {
  ru: {}, en: { btl: "bottle" }, uz: { dona: "pcs", flakon: "bottle", qadoq: "pack" },
};

export function productPageUnit(value: string, copy: UnitCopy): string {
  return PAGE_UNITS.has(value) && Object.hasOwn(UNIT_KEYS, value)
    ? copy(UNIT_KEYS[value as keyof typeof UNIT_KEYS]) : value;
}

export function productEditorUnit(value: string, copy: UnitCopy): string {
  const trimmed = value.trim();
  const key = trimmed.toLowerCase();
  return Object.hasOwn(UNIT_KEYS, key) ? copy(UNIT_KEYS[key as keyof typeof UNIT_KEYS]) : trimmed;
}

/** Called only by a real input event, never by locale changes or initialization. */
export function parseProductUnitInput(text: string, locale: Locale): string {
  const value = text.trim();
  if (Object.hasOwn(UNIT_KEYS, value)) return value;
  const lower = value.toLowerCase();
  if (Object.hasOwn(RUSSIAN_INPUT, lower)) return RUSSIAN_INPUT[lower];
  const selected = SELECTED_INPUT[locale];
  return Object.hasOwn(selected, lower) ? selected[lower] : value;
}

type ProductMethod = "POST" | "PUT" | "DELETE";
const ERROR_CODES = {
  PRODUCT_UNAUTHORIZED: { key: "errors.unauthorized", status: 401, methods: ["POST", "PUT", "DELETE"] },
  PRODUCT_MANAGEMENT_REQUIRED: { key: "errors.managementRequired", status: 403, methods: ["POST", "PUT", "DELETE"] },
  PRODUCT_ID_REQUIRED: { key: "errors.idRequired", status: 400, methods: ["PUT", "DELETE"] },
  PRODUCT_NOT_FOUND: { key: "errors.notFound", status: 404, methods: ["PUT", "DELETE"] },
  PRODUCT_NAME_REQUIRED_CREATE: { key: "errors.nameRequiredCreate", status: 400, methods: ["POST"] },
  PRODUCT_NAME_REQUIRED_UPDATE: { key: "errors.nameRequiredUpdate", status: 400, methods: ["PUT"] },
  PRODUCT_DUPLICATE_NAME: { key: "errors.duplicateName", status: 400, methods: ["POST"] },
  PRODUCT_FAILED: { key: "errors.failed", status: 500, methods: ["POST", "PUT", "DELETE"] },
} as const;
export type ProductErrorKey = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]["key"];

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function productErrorKey(value: unknown, method: ProductMethod, status: number): ProductErrorKey | null {
  if (!record(value) || !Object.hasOwn(value, "errorCode") || typeof value.errorCode !== "string"
    || !Object.hasOwn(ERROR_CODES, value.errorCode)) return null;
  const entry = ERROR_CODES[value.errorCode as keyof typeof ERROR_CODES];
  return entry.status === status && (entry.methods as readonly ProductMethod[]).includes(method) ? entry.key : null;
}

export type ProductUsageMessage =
  | { key: "usage.existingDocuments"; params: { name: string; count: number } }
  | { key: "usage.removedFromChoices" | "usage.unused" };

/** Opt-in producer metadata only. Old prose is neither matched nor displayed. */
export function productUsageMessages(value: unknown): ProductUsageMessage[] {
  if (!record(value) || !Object.hasOwn(value, "usagePresentation") || !record(value.usagePresentation)) return [];
  const presentation = value.usagePresentation;
  if (!Object.hasOwn(presentation, "version") || presentation.version !== 1
    || !Object.hasOwn(presentation, "warnings") || !Array.isArray(presentation.warnings)) return [];
  const messages: ProductUsageMessage[] = [];
  for (const warning of presentation.warnings) {
    if (!record(warning) || !Object.hasOwn(warning, "code")) continue;
    if (warning.code === "PRODUCT_USAGE_EXISTING_DOCUMENTS") {
      if (!Object.hasOwn(warning, "params") || !record(warning.params)) continue;
      const params = warning.params;
      if (!Object.hasOwn(params, "name") || typeof params.name !== "string"
        || !Object.hasOwn(params, "count") || typeof params.count !== "number"
        || !Number.isSafeInteger(params.count) || params.count <= 0
        || Object.keys(params).length !== 2) continue;
      messages.push({ key: "usage.existingDocuments", params: { name: params.name, count: params.count } });
    } else if (!Object.hasOwn(warning, "params")) {
      if (warning.code === "PRODUCT_USAGE_REMOVED_FROM_CHOICES") messages.push({ key: "usage.removedFromChoices" });
      if (warning.code === "PRODUCT_USAGE_UNUSED") messages.push({ key: "usage.unused" });
    }
  }
  return messages;
}
