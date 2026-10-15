export const PLAN_SHIFTS = ["morning", "evening", "night"] as const;
export const PLAN_PRIORITIES = ["P1", "P2", "P3"] as const;
export type PlanItem = { sku: string; targetQuantity: number; priority: string };

const LEGACY_ERRORS = {
  "Не авторизован": "unauthorized",
  "Это действие доступно руководителю": "forbidden",
  "Некорректное тело": "invalidBody",
  "date обязательна": "dateRequired",
  "Некорректная дата": "invalidDate",
  "План на эту дату и смену уже есть. Откройте его в списке планов или выберите другую смену.": "duplicate",
} as const;

export function planErrorKey(error: unknown, status?: number) {
  if (typeof error === "string" && Object.hasOwn(LEGACY_ERRORS, error)) return LEGACY_ERRORS[error as keyof typeof LEGACY_ERRORS];
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 409) return "duplicate";
  return "saveFailed";
}

/** Keep persisted codes, date strings and user-entered text independent of labels. */
export function readPlanFormData(form: Pick<FormData, "get">, shift: string, items: PlanItem[]) {
  return { date: form.get("date"), shift, items: items.filter(item => item.sku), notes: form.get("notes") || null };
}
