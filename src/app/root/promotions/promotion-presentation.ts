import type { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatPriceRub } from "@/components/pricing/promo-price";
import { formatMskDateTime, PROMOTION_TITLE_MAX, PROMOTION_NOTE_MAX, PROMOTION_MIN_PERCENT, PROMOTION_MAX_PERCENT, type PromotionAuditEntry } from "@/lib/promo/promotions";
import { readPromotionAuditPresentation } from "@/lib/promo/promotion-audit-presentation";

export type PromotionCopy = ReturnType<typeof useTranslations<"rootPromotions">>;
const ACTION_KEYS = { "promotion.create": "actionCreate", "promotion.update": "actionUpdate", "promotion.enable": "actionEnable", "promotion.disable": "actionDisable", "promotion.delete": "actionDelete" } as const;
export function promotionActionLabel(action: string, t: PromotionCopy): string {
  return Object.hasOwn(ACTION_KEYS, action) ? t(ACTION_KEYS[action as keyof typeof ACTION_KEYS]) : action;
}
export function formatPromotionAmount(value: number, locale: Locale): string {
  return formatPriceRub(value, locale === "uz" && Number.isFinite(value) ? "ru" : locale);
}
/** Match only known application validation outputs; arbitrary API prose is never exposed. */
export function promotionError(error: unknown, t: PromotionCopy, fallback: "saveFailed" | "changeFailed" | "deleteFailed" = "saveFailed"): string {
  if (error === "Укажите название акции") return t("validationTitle");
  if (error === `Название — не длиннее ${PROMOTION_TITLE_MAX} символов`) return t("validationTitleMax", { max: PROMOTION_TITLE_MAX });
  if (error === `Скидка — целое число от ${PROMOTION_MIN_PERCENT} до ${PROMOTION_MAX_PERCENT} %`) return t("validationPercent", { min: PROMOTION_MIN_PERCENT, max: PROMOTION_MAX_PERCENT });
  if (error === "Укажите начало и конец акции") return t("validationDates");
  if (error === "Конец акции должен быть позже начала") return t("validationEnd");
  if (error === `Заметка — не длиннее ${PROMOTION_NOTE_MAX} символов`) return t("validationNote", { max: PROMOTION_NOTE_MAX });
  if (error === "Акция не найдена") return t("notFound");
  if (error === "Некорректные данные") return t("invalidRequest");
  return t(fallback);
}
export function promotionHistorySummary(entry: PromotionAuditEntry & { presentation?: unknown }, t: PromotionCopy): string | null {
  const value = readPromotionAuditPresentation(entry);
  if (!value) return entry.summary;
  if (value.kind !== "change") return t("historyWindow", { percent: value.percent, start: formatMskDateTime(new Date(value.startsAt)), end: formatMskDateTime(new Date(value.endsAt)), disabled: value.kind === "create" && !value.active ? "yes" : "no" });
  const { before, after } = value, clauses: string[] = [];
  if (before.title !== after.title) clauses.push(t("historyRename", { before: before.title, after: after.title }));
  if (before.percent !== after.percent) clauses.push(t("historyPercent", { before: before.percent, after: after.percent }));
  if (before.startsAt !== after.startsAt) clauses.push(t("historyStart", { before: formatMskDateTime(new Date(before.startsAt)), after: formatMskDateTime(new Date(after.startsAt)) }));
  if (before.endsAt !== after.endsAt) clauses.push(t("historyEnd", { before: formatMskDateTime(new Date(before.endsAt)), after: formatMskDateTime(new Date(after.endsAt)) }));
  if (before.active !== after.active) clauses.push(t(after.active ? "historyEnabled" : "historyDisabled"));
  if (value.noteChanged) clauses.push(t("historyNote"));
  return clauses.join("; ") || t("historyUnchanged");
}
