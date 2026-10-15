export const LOSS_CATEGORIES = ["overweight", "underweight", "packaging_defect", "rework", "writeoff", "bottleneck_idle", "raw_material_variance", "other"] as const;
export const LOSS_UNITS = ["kg", "g", "l", "ml", "pcs", "pc", "bottle", "pack"] as const;
export function lossUnitCode(unit: string) {
  const code = unit.trim().toLowerCase();
  return (LOSS_UNITS as readonly string[]).includes(code) ? code as typeof LOSS_UNITS[number] : null;
}
export function isLossCategory(value: string): value is typeof LOSS_CATEGORIES[number] {
  return (LOSS_CATEGORIES as readonly string[]).includes(value);
}

const LEGACY_ERRORS = {
  "Не авторизован": "unauthorized",
  "productName обязателен": "productRequired",
  "quantity должен быть положительным числом": "quantityInvalid",
  "costRub должен быть положительным числом": "costInvalid",
  "Некорректная дата": "dateInvalid",
  "Помещение не найдено": "areaNotFound",
} as const;
export function lossErrorKey(error: unknown, status?: number) {
  if (typeof error === "string" && Object.hasOwn(LEGACY_ERRORS, error)) return LEGACY_ERRORS[error as keyof typeof LEGACY_ERRORS];
  if (status === 401) return "unauthorized";
  return "saveFailed";
}

/** No locale-dependent conversion of submitted quantities, currency or names. */
export function readLossFormData(form: Pick<FormData, "get">, choices: { category: string; unit: string; areaId: string }) {
  return {
    category: choices.category, productName: form.get("productName"), quantity: form.get("quantity"),
    unit: choices.unit, costRub: form.get("costRub") || null, cause: form.get("cause") || null,
    areaId: choices.areaId || null,
  };
}
