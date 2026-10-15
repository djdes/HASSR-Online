import type { Locale } from "@/i18n/locales";

export const CAPA_STATUSES = ["open", "investigating", "corrective_action", "verification", "closed"] as const;
export type CapaStatus = typeof CAPA_STATUSES[number];
export const CAPA_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export const CAPA_CATEGORIES = ["temperature", "hygiene", "packaging", "quality", "process", "equipment", "other"] as const;
export function isCapaStatus(value: string): value is CapaStatus | "rejected" {
  return value === "rejected" || (CAPA_STATUSES as readonly string[]).includes(value);
}
export function isCapaPriority(value: string): value is typeof CAPA_PRIORITIES[number] {
  return (CAPA_PRIORITIES as readonly string[]).includes(value);
}
export function isCapaCategory(value: string): value is typeof CAPA_CATEGORIES[number] | "training" {
  return value === "training" || (CAPA_CATEGORIES as readonly string[]).includes(value);
}

export const CAPA_TEMPLATES = [
  { id: "temp_high", priority: "high", category: "temperature", slaHours: "24" },
  { id: "rejected_supply", priority: "high", category: "quality", slaHours: "24" },
  { id: "hygiene_violation", priority: "high", category: "hygiene", slaHours: "24" },
  { id: "ccp_breach", priority: "critical", category: "process", slaHours: "2" },
  { id: "equipment_failure", priority: "medium", category: "equipment", slaHours: "48" },
  { id: "pest_sighting", priority: "high", category: "process", slaHours: "24" },
  { id: "glass_breakage", priority: "high", category: "quality", slaHours: "24" },
  { id: "training_overdue", priority: "medium", category: "hygiene", slaHours: "48" },
] as const;

export const CAPA_WORKFLOW = {
  open: { nextStatus: "investigating", field: "rootCause", suggestStep: null },
  investigating: { nextStatus: "corrective_action", field: "rootCause", suggestStep: "root_cause" },
  corrective_action: { nextStatus: "verification", field: "correctiveAction", suggestStep: "corrective" },
  verification: { nextStatus: "closed", field: "verificationResult", suggestStep: null },
} as const;
export function capaWorkflowStep(status: string) {
  return Object.hasOwn(CAPA_WORKFLOW, status) ? status as keyof typeof CAPA_WORKFLOW : null;
}
export function capaWorkflowPayload(status: string, value: string) {
  const key = capaWorkflowStep(status);
  if (!key) return null;
  const step = CAPA_WORKFLOW[key];
  return { status: step.nextStatus, [step.field]: value || undefined };
}

const LEGACY_ERRORS = {
  "Не авторизован": "unauthorized",
  "Это действие доступно руководителю": "forbidden",
  "Заголовок обязателен": "titleRequired",
  "Сотрудник не найден": "assigneeNotFound",
  "Не найдено": "notFound",
  "Некорректный статус CAPA": "statusInvalid",
  "AI вернул некорректный JSON": "suggestInvalid",
  "AI не вернул suggestions": "suggestInvalid",
} as const;
export const CAPA_ERROR_CODES = {
  UNAUTHORIZED: "unauthorized", FORBIDDEN: "forbidden", NOT_FOUND: "notFound",
  INVALID_LOCALE: "invalidLocale", INVALID_STEP: "invalidStep",
  SUGGEST_UNAVAILABLE: "suggestUnavailable", SUGGEST_FAILED: "suggestFailed", SUGGEST_INVALID: "suggestInvalid",
} as const;
export function capaErrorKey(error: unknown, status?: number, code?: unknown, fallback: "saveFailed" | "detectFailed" | "suggestFailed" = "saveFailed") {
  if (typeof code === "string" && Object.hasOwn(CAPA_ERROR_CODES, code)) return CAPA_ERROR_CODES[code as keyof typeof CAPA_ERROR_CODES];
  if (typeof error === "string" && Object.hasOwn(LEGACY_ERRORS, error)) return LEGACY_ERRORS[error as keyof typeof LEGACY_ERRORS];
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 503) return "suggestUnavailable";
  return fallback;
}

/** Preserve regulatory context and user data while selecting output language. */
export function capaSuggestionLanguageInstruction(locale: Locale): string {
  const language = { ru: "Russian", en: "English", uz: "Uzbek using the Latin alphabet" }[locale];
  return `Write every suggestion title and text in ${language}. Keep JSON property names unchanged. Preserve user-provided names, identifiers, numeric values and the existing regulatory context; do not substitute another jurisdiction's requirements.`;
}

export function readCapaFormData(form: Pick<FormData, "get">, choices: { priority: string; category: string; slaHours: string; assignedToId: string }) {
  return {
    title: form.get("title"), description: form.get("description") || null,
    priority: choices.priority, category: choices.category, slaHours: Number(choices.slaHours),
    assignedToId: choices.assignedToId || null, dueDate: form.get("dueDate") || null,
  };
}
