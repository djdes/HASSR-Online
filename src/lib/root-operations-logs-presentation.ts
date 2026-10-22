import { createTranslator } from "use-intl/core";
import type { Locale } from "@/i18n/locales";
import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";

export function rootOperationsCopy(locale: Locale) {
  return createTranslator({ locale, messages: { ru, en, uz }[locale].rootOperationsLogs });
}

export function formatRootTimingDuration(ms: number, locale: Locale): string {
  const t = rootOperationsCopy(locale);
  if (ms < 1000) return t("duration.milliseconds", { value: ms });
  const sec = Math.round(ms / 1000);
  if (sec < 60) return t("duration.seconds", { value: sec });
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return remSec === 0
    ? t("duration.minutes", { value: min })
    : t("duration.minutesSeconds", { minutes: min, seconds: remSec });
}

const STATUS_KEYS = {
  sent: "statuses.sent",
  queued: "statuses.queued",
  failed: "statuses.failed",
  rate_limited: "statuses.rate_limited",
  push_only: "statuses.push_only",
  deferred: "statuses.deferred",
} as const;

export function rootTelegramStatus(status: string, locale: Locale): string {
  return Object.hasOwn(STATUS_KEYS, status)
    ? rootOperationsCopy(locale)(STATUS_KEYS[status as keyof typeof STATUS_KEYS])
    : status;
}
