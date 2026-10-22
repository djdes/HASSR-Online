import { formatCalendarDate } from "@/i18n/calendar-date";
import type { Locale } from "@/i18n/locales";

export function ageParts(from: Date | string, now: Date = new Date()) {
  const fromMs = typeof from === "string" ? new Date(from).getTime() : from.getTime();
  const minutes = Math.max(0, Math.round((now.getTime() - fromMs) / 60_000));
  if (minutes < 1) return { key: "ageNow", count: "0" } as const;
  if (minutes < 60) return { key: "ageMinutes", count: String(minutes) } as const;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: "ageHours", count: String(hours) } as const;
  return { key: "ageDays", count: String(Math.floor(hours / 24)) } as const;
}

type AgeKey = ReturnType<typeof ageParts>["key"];
export function chatAge(from: Date | string, t: (key: AgeKey, values: { count: string }) => string, now?: Date) {
  const part = ageParts(from, now);
  return t(part.key, { count: part.count });
}

/** Preserve the host zone, native RU/EN/invalid output and seconds. */
export function formatChatTimestamp(value: string, locale: Locale): string {
  const date = new Date(value);
  const nativeLocale = locale === "ru" ? "ru-RU" : locale === "en" ? "en-GB" : "uz-Latn-UZ";
  if (locale !== "uz" || !Number.isFinite(date.getTime())) return date.toLocaleString(nativeLocale);
  const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const day = formatCalendarDate(nativeLocale, date, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone, hourCycle: "h23", numberingSystem: "latn", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(date);
  return `${day}, ${time}`;
}

/** Responses are untrusted; never render arbitrary API or network diagnostics. */
const ERROR_KEYS = {
  "Выберите организацию": "chooseOrganization",
  "Организация не найдена": "organizationMissing",
  "Слишком много сообщений подряд": "tooManyMessages",
  "Вложения не прошли проверку — прикрепите файлы заново": "invalidAttachments",
  "Сообщение слишком короткое": "messageTooShort",
  "Сообщение слишком длинное": "messageTooLong",
  "Некорректное сообщение": "invalidMessage",
  "Напишите хотя бы пару предложений": "broadcastTooShort",
  "Некорректный id рассылки": "invalidBroadcastId",
  "Некорректные данные": "invalidMessage",
  "Рассылка уже запущена недавно — подождите 10 минут": "broadcastRateLimited",
} as const;
export function chatErrorKey(value: unknown, fallback: "sendFailed" | "broadcastFailed" = "sendFailed") {
  return typeof value === "string" && Object.hasOwn(ERROR_KEYS, value) ? ERROR_KEYS[value as keyof typeof ERROR_KEYS] : fallback;
}

/** Whole messages for the exact reported delivery matrix; payload flags stay unchanged. */
export function deliveryKey(delivered: { telegram?: boolean; inApp?: boolean } | undefined, operation: "reply" | "compose") {
  if (delivered?.inApp && delivered?.telegram) return operation === "reply" ? "replyDeliveredBoth" : "composeDeliveredBoth";
  if (delivered?.inApp) return operation === "reply" ? "replyDeliveredInApp" : "composeDeliveredInApp";
  if (delivered?.telegram) return operation === "reply" ? "replyDeliveredTelegram" : "composeDeliveredTelegram";
  return "deliveredChat";
}
