import type { Locale } from "@/i18n/locales";
import type { Messages } from "@/i18n/messages";
import { journalTitle } from "@/i18n/journal-presentation";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import type { JournalPeriodKind } from "@/lib/journal-period";

const officialNames = new Map<string, string>(ACTIVE_JOURNAL_CATALOG.map((item) => [item.code, item.name]));
export function journalPeriodsDisplayName(locale: Locale, names: Messages["journals"]["names"], item: { code: string; name: string }): string {
  return officialNames.get(item.code) === item.name ? journalTitle(locale, names, item.code, item.name) : item.name;
}
export const PERIOD_KIND_KEYS = {
  monthly: "kinds.monthly", yearly: "kinds.yearly", "half-monthly": "kinds.halfMonthly",
  "single-day": "kinds.singleDay", perpetual: "kinds.perpetual", days: "kinds.days",
} as const satisfies Record<JournalPeriodKind, string>;
export type JournalPeriodsErrorKey = "feedback.forbidden" | "feedback.invalidBody" | "feedback.invalidDays" | "feedback.unauthorized" | "feedback.saveFailed";
const errors = {
  JOURNAL_PERIODS_FORBIDDEN: { status: 403, key: "feedback.forbidden" },
  JOURNAL_PERIODS_INVALID_BODY: { status: 400, key: "feedback.invalidBody" },
  JOURNAL_PERIODS_INVALID_DAYS: { status: 400, key: "feedback.invalidDays" },
} as const;
export function journalPeriodsSaveError(data: unknown, status: number): JournalPeriodsErrorKey {
  if (status === 401) return "feedback.unauthorized";
  if (!data || typeof data !== "object" || Array.isArray(data)) return "feedback.saveFailed";
  const field = Object.getOwnPropertyDescriptor(data, "errorCode");
  if (field) {
    const code: unknown = field.value;
    if (typeof code !== "string" || !Object.hasOwn(errors, code)) return "feedback.saveFailed";
    const error = errors[code as keyof typeof errors];
    return error.status === status ? error.key : "feedback.saveFailed";
  }
  // Old routes have one403 family; their two400 families cannot be distinguished safely.
  return status === 403 ? "feedback.forbidden" : status === 400 ? "feedback.invalidBody" : "feedback.saveFailed";
}
