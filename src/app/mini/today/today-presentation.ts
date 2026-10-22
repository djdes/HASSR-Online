import type { useTranslations } from "next-intl";
import { formatDate, type Locale } from "@/i18n/locales";
import { isFetchNetworkError } from "@/lib/humanize-fetch-error";

type Translator = ReturnType<typeof useTranslations<"miniToday">>;
export type TodayAction = "load" | "claim" | "complete" | "release";
const REASONS = {
  taken_by_other: "errors.taken", scope_completed: "errors.scopeCompleted",
  manual_mode: "errors.manual", internal_error: "errors.internal",
  not_found: "errors.notFound", not_owner: "errors.notOwner",
  not_active: "errors.notActive", validation_failed: "errors.validation",
} as const;
const LEGACY_ERRORS = {
  "Невалидный запрос": "errors.invalidRequest",
  "Невалидная дата": "errors.invalidDate",
  "Нет доступа к этому журналу": "errors.forbidden",
} as const;
type PlainErrorKey = typeof REASONS[keyof typeof REASONS] | typeof LEGACY_ERRORS[keyof typeof LEGACY_ERRORS]
  | "errors.signIn" | "errors.session" | "errors.loadForbidden" | "errors.loadNetwork"
  | "errors.network" | "errors.claim" | "errors.complete" | "errors.release"
  | "errors.activeUnknown" | "errors.conflict";
export type TodayError = { key: PlainErrorKey } | { key: "errors.load"; status: number } | { key: "errors.active"; task: string };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Stable reasons and validated parameters only; unknown server prose is never UI copy. */
export function todayApiError(body: unknown, status: number, action: TodayAction): TodayError {
  if (status === 401) return { key: action === "load" ? "errors.signIn" : "errors.session" };
  if (action === "load") return status === 403 ? { key: "errors.loadForbidden" } : { key: "errors.load", status };
  const payload = object(body);
  const reason = payload?.reason;
  if (reason === "user_has_active") {
    const active = object(payload?.activeClaim);
    const task = typeof active?.parentHint === "string" && active.parentHint ? active.parentHint : active?.scopeLabel;
    return typeof task === "string" && task ? { key: "errors.active", task } : { key: "errors.activeUnknown" };
  }
  if (typeof reason === "string" && Object.hasOwn(REASONS, reason)) return { key: REASONS[reason as keyof typeof REASONS] };
  const legacy = payload?.error ?? payload?.message;
  if (typeof legacy === "string" && Object.hasOwn(LEGACY_ERRORS, legacy)) return { key: LEGACY_ERRORS[legacy as keyof typeof LEGACY_ERRORS] };
  if (status === 403) return { key: "errors.forbidden" };
  if (status === 404) return { key: "errors.notFound" };
  if (status === 409) return { key: action === "claim" ? "errors.taken" : "errors.conflict" };
  return { key: action === "claim" ? "errors.claim" : action === "complete" ? "errors.complete" : "errors.release" };
}

export async function readTodayError(response: Response, action: TodayAction): Promise<TodayError> {
  return todayApiError(await response.json().catch(() => null), response.status, action);
}

export function todayCaughtError(error: unknown, action: TodayAction): TodayError {
  if (action === "load") return { key: "errors.loadNetwork" };
  if (isFetchNetworkError(error)) return { key: "errors.network" };
  return { key: action === "claim" ? "errors.claim" : action === "complete" ? "errors.complete" : "errors.release" };
}

export function presentTodayError(t: Translator, error: TodayError): string {
  if (error.key === "errors.load") return t(error.key, { status: error.status });
  if (error.key === "errors.active") return t(error.key, { task: error.task });
  return t(error.key);
}

const GROUP_CODES = ["hygiene", "health_check", "cold_equipment_control", "climate_control", "cleaning", "incoming_control", "finished_product", "disinfectant_usage", "fryer_oil", "accident_journal", "complaint_register", "breakdown_history", "ppe_issuance", "glass_items_list", "glass_control", "metal_impurity", "perishable_rejection", "product_writeoff", "traceability_test", "general_cleaning", "sanitation_day_control", "sanitary_day_control", "pest_control", "intensive_cooling", "uv_lamp_runtime", "equipment_maintenance", "equipment_calibration", "equipment_cleaning", "audit_plan", "audit_protocol", "audit_report", "training_plan"] as const;

export function todayJournalLabel(t: Translator, code: string, original: string, origin?: string): string {
  if (origin !== "builtin" || !(GROUP_CODES as readonly string[]).includes(code)) return original;
  return t(`groups.${code as typeof GROUP_CODES[number]}`);
}

/** Format an already-calculated business day; never convert the organization's date to another timezone. */
export function todayDayLabel(dateKey: string, locale: Locale, weekday = false): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  return formatDate(locale, new Date(Date.UTC(year, month - 1, day)), "UTC", { ...(weekday ? { weekday: "long" as const } : {}), day: "numeric", month: "long",
  });
}

const SCHEDULE_KEYS = { sick: "sick", sick_leave: "sick", vacation: "vacation", off: "off", day_off: "off" } as const;
export function todaySchedule(t: Translator, locale: Locale, status?: string | null, note?: { kind: string; text: string; untilKey?: string | null } | null): string | null {
  const kind = note?.kind ?? status;
  if (!kind || !Object.hasOwn(SCHEDULE_KEYS, kind)) return note?.text ?? null;
  const variant = SCHEDULE_KEYS[kind as keyof typeof SCHEDULE_KEYS];
  if (note) {
    // Old payloads may include an end date only in prose. Do not lose or infer it.
    if (!Object.hasOwn(note, "untilKey")) return note.text;
    if (note.untilKey !== null) {
      if (typeof note.untilKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(note.untilKey)) return note.text;
      const [year, month, day] = note.untilKey.split("-").map(Number);
      const value = new Date(Date.UTC(year, month - 1, day));
      if (value.toISOString().slice(0, 10) !== note.untilKey) return note.text;
      const date = formatDate(locale, value, "UTC", { day: "2-digit", month: "2-digit" });
      return t(`schedule.${variant}Until`, { date });
    }
  }
  return t(`schedule.${variant}`);
}
