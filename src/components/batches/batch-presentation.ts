/** Stable persisted values are translated only at the presentation boundary. */
export const BATCH_STATUSES = ["received", "in_production", "finished", "shipped", "expired", "written_off"] as const;
export type BatchStatus = typeof BATCH_STATUSES[number];
export const BATCH_FILTERS = ["all", ...BATCH_STATUSES] as const;

export function isBatchStatus(status: string): status is BatchStatus {
  return (BATCH_STATUSES as readonly string[]).includes(status);
}

export const BATCH_UNITS = ["kg", "g", "l", "ml", "pcs", "pc", "bottle", "pack"] as const;
export type BatchUnit = typeof BATCH_UNITS[number];

export function batchUnitCode(unit: string | null | undefined): BatchUnit | null {
  const key = (unit ?? "").trim().toLowerCase();
  return (BATCH_UNITS as readonly string[]).includes(key) ? key as BatchUnit : null;
}

/** Read submitted data without translating values or converting quantities. */
export function readBatchFormData(form: Pick<FormData, "get">) {
  return {
    productName: form.get("productName"),
    supplier: form.get("supplier"),
    quantity: form.get("quantity"),
    unit: form.get("unit"),
    expiryDate: form.get("expiryDate") || null,
    notes: form.get("notes") || null,
  };
}

// Compatibility with existing API response fields; unknown server details are
// not exposed as untranslated UI text. Stable codes can replace this adapter.
const LEGACY_ERROR_KEYS = {
  "Не авторизован": "unauthorized",
  "productName обязателен": "productRequired",
  "quantity должен быть положительным числом": "quantityInvalid",
  "Некорректная дата": "dateInvalid",
  "Некорректная дата поступления": "receivedDateInvalid",
  "Не удалось сгенерировать уникальный код партии. Попробуйте ещё раз.": "codeUnavailable",
  "Это действие доступно руководителю": "forbidden",
  "Не найдено": "notFound",
  "Неизвестный статус партии": "statusInvalid",
} as const;

export function batchErrorKey(error: unknown, status?: number) {
  if (typeof error === "string" && Object.hasOwn(LEGACY_ERROR_KEYS, error)) {
    return LEGACY_ERROR_KEYS[error as keyof typeof LEGACY_ERROR_KEYS];
  }
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  return "saveFailed";
}
