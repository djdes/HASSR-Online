import type { useTranslations } from "next-intl";
import { formatDate, type Locale } from "@/i18n/locales";
import { presentDocumentTitle } from "@/i18n/journal-document-presentation";
import { FINISHED_PRODUCT_ARCHIVE_DOCUMENT_TITLES, FINISHED_PRODUCT_DOCUMENT_TITLE, finishedProductCellText, type FinishedProductDocumentConfig, type FinishedProductDocumentRow } from "@/lib/finished-product-document";
import type { ResolvedJournalColumn } from "@/lib/journal-columns";
import { BRAKERAGE_TIME_OFFSETS_DEFAULT, chainBrakerageTimes } from "@/lib/brakerage-times";
import { unsignedRows, unsignedRowLabel } from "@/lib/brakerage-commission";

export type FinishedProductTranslator = ReturnType<typeof useTranslations<"finishedProduct">>;
const COLUMN_KEYS = ["production", "rejection", "name", "organoleptic", "release", "signatures", "portion", "note", "temp", "corrective", "oxygen", "release_allowed", "courier", "responsible", "inspector"] as const;
const GRADE_KEYS = {
  "Отлично": "excellent", "Хорошо": "good", "Удовлетворительно": "satisfactory", "Неудовлетворительно": "unsatisfactory",
  "Доброкачественно": "sound", "Недоброкачественно": "unsound", "Соответствует": "compliant", "Требует доработки": "rework", "Не соответствует": "nonCompliant",
} as const;

/** Canonical display only: configured grades remain customer-owned even when
 * their spelling happens to equal a built-in option. */
export function finishedGrade(value: string, config: Pick<FinishedProductDocumentConfig, "organolepticOptions">, t: FinishedProductTranslator) {
  if (config.organolepticOptions.length > 0) return value;
  const key = GRADE_KEYS[value as keyof typeof GRADE_KEYS];
  return key ? t(`grades.${key}`) : value;
}

export function finishedColumn(column: ResolvedJournalColumn, config: FinishedProductDocumentConfig, t: FinishedProductTranslator): ResolvedJournalColumn {
  const key = COLUMN_KEYS.find(key => key === column.key);
  if (!key || column.custom) return column;
  const defaultLabel = t(`columns.${key === "name" && config.fieldNameMode === "semi" ? "nameSemi" : key === "inspector" && config.inspectorMode === "commission_signatures" ? "inspectorCommission" : key}`);
  const customLabel = Object.prototype.hasOwnProperty.call(config.columns?.labels ?? {}, key);
  return { ...column, defaultLabel, label: customLabel ? column.label : defaultLabel };
}

export function finishedCell(row: FinishedProductDocumentRow, key: string, config: FinishedProductDocumentConfig, t: FinishedProductTranslator, options: { timeZone?: string; fallbackSignatureName?: string } = {}) {
  if (key === "organoleptic") return finishedGrade(row.organoleptic, config, t);
  if (key === "release_allowed") return t(row.releaseAllowed === "no" ? "fields.no" : "fields.yes");
  if (key === "release") {
    if (row.releaseAllowed === "no") return t("fields.notAllowed");
    const time = /(\d{1,2}:\d{2})\s*$/.exec(row.releasePermissionTime.trim())?.[1];
    return time ? t("releaseAt", { time }) : t("fields.allowed");
  }
  return finishedProductCellText(row, key, { ...options, fallbackSignatureName: config.commissionMembers.length ? undefined : options.fallbackSignatureName });
}

export function finishedDate(value: string, locale: Locale) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (locale === "ru") return value.split("-").reverse().join("-");
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? value : formatDate(locale, date, "UTC", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function finishedTitle(title: string, dateFrom: string, dateTo: string, locale: Locale, t: FinishedProductTranslator) {
  const name = title === FINISHED_PRODUCT_ARCHIVE_DOCUMENT_TITLES[0] ? t("archiveTemperatureTitle") : title === FINISHED_PRODUCT_ARCHIVE_DOCUMENT_TITLES[1] ? t("archiveShortTitle") : title === FINISHED_PRODUCT_ARCHIVE_DOCUMENT_TITLES[2] ? t("shortTitle") : t("title");
  return presentDocumentTitle({ title, templateCode: "finished_product", sourceNames: [FINISHED_PRODUCT_DOCUMENT_TITLE, ...FINISHED_PRODUCT_ARCHIVE_DOCUMENT_TITLES], localizedName: name, dateFrom, dateTo, locale, formatTitle: (name, period) => t("generatedTitle", { name, period }) });
}

export function finishedChainCaption(params: Parameters<typeof chainBrakerageTimes>[0], t: FinishedProductTranslator) {
  const offsets = { ...BRAKERAGE_TIME_OFFSETS_DEFAULT, ...params.offsets };
  const times = chainBrakerageTimes(params);
  if (!times.rejectionTime) return t("time.chainEmpty");
  const common = { time: times.rejectionTime.slice(11, 16), minutes: offsets.rejectionAfterProductionMinutes };
  return params.releaseAllowed === "no" ? t("time.chainNoRelease", common) : t("time.chainRelease", { ...common, releaseTime: times.releasePermissionTime.slice(11, 16), releaseMinutes: offsets.releaseAfterRejectionMinutes });
}

export function finishedCloseBlocker(config: Parameters<typeof unsignedRows>[0], t: FinishedProductTranslator) {
  const rows = unsignedRows(config);
  if (!rows.length) return null;
  const bullets = rows.slice(0, 8).map(row => unsignedRowLabel({ ...row, productName: typeof row.productName === "string" && row.productName.trim() ? row.productName : t("actions.noName") }));
  if (rows.length > 8) bullets.push(t("signatures.more", { count: rows.length - 8 }));
  return { title: t("signatures.blockTitle", { count: rows.length }), description: t("signatures.blockDescription"), bullets };
}

export function finishedTodaySignatures(summary: { total: number; waiting: number }, canSign: boolean, t: FinishedProductTranslator) {
  return summary.waiting === 0 ? t("signatures.todaySigned", { total: summary.total }) : t(canSign ? "signatures.todayWaitingCanSign" : "signatures.todayWaiting", summary);
}
