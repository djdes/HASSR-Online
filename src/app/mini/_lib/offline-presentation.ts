import { formatDate, type Locale } from "@/i18n/locales";
import type { useTranslations } from "next-intl";

type QueueText = ReturnType<typeof useTranslations<"miniOffline">>;

/** Project known legacy diagnostics for display only; never modify stored rows. */
export function formatQueueError(error: string, t: QueueText): string {
  if (error === "Фото потеряно — запишите заново со снимком") return t("errors.missingPhoto");
  if (error === "Сервер не принял фото") return t("errors.rejectedPhoto");
  const rejected = /^Сервер не принял запись \((\d{3})\)$/.exec(error);
  if (rejected && rejected[0] === error) return t("errors.serverRejected", { status: rejected[1] });
  return t("errors.generic");
}

/** Keep the phone's local calendar day and24-hour clock; language never changes timezone. */
export function formatQueueWhen(timestamp: number, locale: Locale, t: QueueText, now = Date.now()): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return t("when.unknown");
  const today = new Date(now);
  const sameDay = date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const time = formatDate(locale, date, timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (sameDay) return t("when.today", { time });
  return t("when.other", { date: formatDate(locale, date, timeZone, { day: "2-digit", month: "2-digit" }), time });
}
