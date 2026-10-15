import type { useTranslations } from "next-intl";
import { formatDate, FORMAT_LOCALES, type Locale } from "@/i18n/locales";
import { presentDocumentTitle } from "@/i18n/journal-document-presentation";
import { normalizeRowSignatures } from "@/lib/brakerage-commission";
import { PERISHABLE_REJECTION_DOCUMENT_TITLE, normalizePerishableTime, perishableCellText, perishablePrintColumns, type PerishableRejectionConfig, type PerishableRejectionRow } from "@/lib/perishable-rejection-document";
import { resolveColumns, type ResolvedJournalColumn } from "@/lib/journal-columns";

export type PerishableTranslator = ReturnType<typeof useTranslations<"perishableRejection">>;
const COLUMN_KEYS = ["arrival", "product", "packaging", "productionDate", "manufacturer", "supplier", "quantity", "document", "organoleptic", "storage", "sale", "responsible", "note"] as const;

export function perishableColumn(column: ResolvedJournalColumn, config: PerishableRejectionConfig, t: PerishableTranslator): ResolvedJournalColumn {
  const key = COLUMN_KEYS.find(key => key === column.key);
  if (!key || column.custom) return column;
  const defaultLabel = t(`columns.${key}`);
  return { ...column, defaultLabel, label: Object.hasOwn(config.columns?.labels ?? {}, key) ? column.label : defaultLabel };
}

export function perishableDate(value: string, locale: Locale) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? value : formatDate(locale, date, "UTC", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function perishableDateTime(date: string, time: string, locale: Locale) {
  return [perishableDate(date, locale), time].filter(Boolean).join(" ");
}

export function perishableTitle(title: string, dateFrom: string, locale: Locale, t: PerishableTranslator) {
  return presentDocumentTitle({ title, templateCode: "perishable_rejection", sourceNames: [PERISHABLE_REJECTION_DOCUMENT_TITLE], localizedName: t("title"), dateFrom, dateTo: dateFrom, locale, formatTitle: (name, period) => t("generatedTitle", { name, period }) });
}

export function perishableCell(row: PerishableRejectionRow, key: string, locale: Locale, t: PerishableTranslator, options: { joiner?: string } = {}) {
  if (key === "organoleptic") {
    const value = row.organolepticResult;
    return ["compliant", "non_compliant", "good_quality", "poor_quality"].includes(value) ? t(`organoleptic.${value}`) : value || "";
  }
  if (key === "storage") {
    const value = row.storageCondition;
    const label = ["2_6", "minus18", "minus2_2"].includes(value) ? t(`storage.${value}`) : value || "";
    return [label, row.expiryDate ? perishableDateTime(row.expiryDate, normalizePerishableTime(row.expiryTime), locale) : ""].filter(Boolean).join(options.joiner ?? ", ");
  }
  if (key === "arrival") return perishableDateTime(row.arrivalDate, row.arrivalTime, locale);
  if (key === "productionDate") return perishableDate(row.productionDate, locale);
  if (key === "sale") return perishableDateTime(row.actualSaleDate, row.actualSaleTime, locale);
  return perishableCellText(row, key, options);
}

export function perishablePrintPresentation(config: PerishableRejectionConfig, t: PerishableTranslator) {
  const columns = resolveColumns("perishable_rejection", config).map(column => perishableColumn(column, config, t));
  return perishablePrintColumns(config).map(column => ({ ...column, head: columns.find(item => item.key === column.key)?.label ?? column.head }));
}

/** Stored signed names and roles are snapshots: only surrounding system copy is translated. */
export function perishableSignatureLines(rows: readonly PerishableRejectionRow[], locale: Locale, t: PerishableTranslator, timeZone = "Europe/Moscow") {
  return rows.flatMap(row => {
    const signatures = normalizeRowSignatures(row.signatures);
    if (!signatures.length) return [];
    const arrival = perishableDateTime(row.arrivalDate, row.arrivalTime, locale);
    const what = [row.productName.trim() || t("signatures.unnamedProduct"), arrival ? t("signatures.arrival", { date: arrival }) : ""].filter(Boolean).join(", ");
    const who = signatures.map(signature => {
      const date = new Date(signature.signedAt);
      let signedAt = "";
      if (!Number.isNaN(date.getTime())) {
        try { signedAt = new Intl.DateTimeFormat(FORMAT_LOCALES[locale], { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replace(",", ""); }
        catch { signedAt = signature.signedAt.slice(0, 16).replace("T", " "); }
      }
      return [`${signature.name || t("signatures.unnamedPerson")}${signature.role ? ` (${signature.role})` : ""}`, signedAt].filter(Boolean).join(", ");
    }).join("; ");
    return [`${what} — ${who}`];
  });
}
