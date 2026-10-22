import { formatCalendarDate } from "@/i18n/calendar-date";
import type { Locale } from "@/i18n/locales";

const STATUS_KEYS = {
  new: "statusNew",
  planned: "statusPlanned",
  in_progress: "statusInProgress",
  done: "statusDone",
  declined: "statusDeclined",
} as const;

/** Only canonical status options receive application copy; stored values stay literal. */
export function ideaStatusKey(value: string) {
  return Object.hasOwn(STATUS_KEYS, value) ? STATUS_KEYS[value as keyof typeof STATUS_KEYS] : undefined;
}

const ERROR_KEYS = {
  "Неизвестный статус": "unknownStatus",
  "Некорректный комментарий": "invalidNote",
  "Нечего менять": "noChanges",
  "Идея не найдена": "notFound",
} as const;

/** Called only with a failed response body, never with untrusted network exception prose. */
export function ideaErrorKey(value: unknown) {
  return typeof value === "string" && Object.hasOwn(ERROR_KEYS, value)
    ? ERROR_KEYS[value as keyof typeof ERROR_KEYS]
    : "saveFailed";
}

/** Date-only presentation in the viewer's host zone, with reviewed Uzbek Latin compatibility. */
export function formatIdeaDate(value: string, locale: Locale): string {
  const date = new Date(value);
  const nativeLocale = locale === "ru" ? "ru-RU" : locale === "en" ? "en-GB" : "uz-Latn-UZ";
  if (locale !== "uz" || Number.isNaN(date.getTime())) return date.toLocaleDateString(nativeLocale);
  return formatCalendarDate(nativeLocale, date, new Intl.DateTimeFormat().resolvedOptions().timeZone);
}
