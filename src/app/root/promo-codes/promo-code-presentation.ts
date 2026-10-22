import { formatDate, type Locale } from "@/i18n/locales";
import { formatMskDateTime } from "@/lib/promo/promotions";
import uzCalendar from "@/i18n/calendar-data/uz.json";

export type PromoApiErrorKey =
  | "invalidData"
  | "invalidCode"
  | "percentTooHigh"
  | "organizationMissing"
  | "duplicateCode"
  | "promoMissing"
  | "lifetimeMissing"
  | "alreadyRevoked";

const KNOWN_API_ERRORS: Readonly<Record<string, PromoApiErrorKey>> = Object.freeze({
  "Некорректные данные": "invalidData",
  "Код: латиница, цифры, «-» и «_», от 3 до 32 символов": "invalidCode",
  "Процент не может быть больше 100": "percentTooHigh",
  "Организация с таким id не найдена": "organizationMissing",
  "Такой код уже есть": "duplicateCode",
  "Промокод не найден": "promoMissing",
  "Скидка не найдена": "lifetimeMissing",
  "Скидка уже отменена": "alreadyRevoked",
});
const PROMO_ERROR_KEYS = new Set(Object.values(KNOWN_API_ERRORS));

export function promoApiErrorKey(value: unknown): PromoApiErrorKey | null {
  return typeof value === "string" && Object.hasOwn(KNOWN_API_ERRORS, value) ? KNOWN_API_ERRORS[value] : null;
}

/** Preserve the original fixed UTC+3 calendar policy and invalid display. */
export function formatPromoDisplayDate(iso: string, locale: Locale): string {
  const date = new Date(iso);
  const original = formatMskDateTime(date).slice(0, 10);
  const shifted = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  if (locale === "ru" || !Number.isFinite(shifted.getTime())) return original;
  if (locale === "uz") {
    // This private shape uses the reviewed date-context month names.
    const parts = new Intl.DateTimeFormat("en-GB", {
      calendar: "gregory", numberingSystem: "latn", timeZone: "UTC",
      day: "2-digit", month: "numeric", year: "numeric",
    }).formatToParts(shifted);
    const part = (type: "day" | "month" | "year") => parts.find((item) => item.type === type)?.value ?? "";
    const month = uzCalendar.months.format.short[Number(part("month")) - 1];
    return `${part("day")}-${month}, ${part("year")}`;
  }
  return formatDate(locale, shifted, "UTC", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function isPromoApiErrorKey(value: unknown): value is PromoApiErrorKey {
  return typeof value === "string" && PROMO_ERROR_KEYS.has(value as PromoApiErrorKey);
}
