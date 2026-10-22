import type { Locale } from "@/i18n/locales";

export type FeedbackReportType = "bug" | "suggestion" | "partnership" | "support";
export type FeedbackReportSource = "site" | "telegram";

const TYPE_KEYS: Record<FeedbackReportType, `page.type.${FeedbackReportType}`> = {
  bug: "page.type.bug",
  suggestion: "page.type.suggestion",
  partnership: "page.type.partnership",
  support: "page.type.support",
};

const SOURCE_KEYS: Record<FeedbackReportSource, `page.source.${FeedbackReportSource}`> = {
  site: "page.source.site",
  telegram: "page.source.telegram",
};

export function feedbackTypeKey(value: string): `page.type.${FeedbackReportType}` {
  return Object.hasOwn(TYPE_KEYS, value)
    ? TYPE_KEYS[value as FeedbackReportType]
    : TYPE_KEYS.suggestion;
}

export function feedbackSourceKey(value: string): `page.source.${FeedbackReportSource}` {
  return Object.hasOwn(SOURCE_KEYS, value)
    ? SOURCE_KEYS[value as FeedbackReportSource]
    : SOURCE_KEYS.site;
}

export type ReplyChannelCombination =
  | "none" | "app" | "telegram" | "email" | "app_telegram" | "app_email"
  | "telegram_email" | "all";

export function replyChannelCombination(app: boolean, telegram: boolean, email: boolean): ReplyChannelCombination {
  if (app && telegram && email) return "all";
  if (app && telegram) return "app_telegram";
  if (app && email) return "app_email";
  if (telegram && email) return "telegram_email";
  if (app) return "app";
  if (telegram) return "telegram";
  if (email) return "email";
  return "none";
}

export type DeliveredReplyCombination = Exclude<ReplyChannelCombination, "none">;

export function deliveredReplyCombination(app: boolean, telegram: boolean, email: boolean): DeliveredReplyCombination | null {
  const combination = replyChannelCombination(app, telegram, email);
  return combination === "none" ? null : combination;
}

export type FeedbackReplyErrorKey = "required" | "invalid" | "notFound" | "failed";

/** Translate only known API messages; arbitrary diagnostics never reach the ROOT UI. */
export function feedbackReplyErrorKey(message: unknown): FeedbackReplyErrorKey {
  if (message === "Введите текст ответа") return "required";
  if (message === "Некорректные данные") return "invalid";
  if (message === "Обращение не найдено") return "notFound";
  return "failed";
}

export function formatFeedbackReportDate(date: Date, locale: Locale): string {
  const options: Intl.DateTimeFormatOptions = { timeZone: "Europe/Moscow" };
  if (locale === "ru") return date.toLocaleString("ru-RU", options);
  if (locale === "en") return date.toLocaleString("en-GB", options);
  if (!Number.isFinite(date.getTime())) return date.toLocaleString("uz-Latn-UZ", options);
  return date.toLocaleString("en-GB", options);
}

export function testNotifyTelegramResultKey(sent: boolean): "test.telegramSent" | "test.telegramNotSent" {
  return sent ? "test.telegramSent" : "test.telegramNotSent";
}

export function testNotifyEmailResultKey(configured: boolean, sent: boolean):
  | "test.emailNotConfiguredResult" | "test.emailSent" | "test.emailFailed" {
  if (!configured) return "test.emailNotConfiguredResult";
  return sent ? "test.emailSent" : "test.emailFailed";
}
