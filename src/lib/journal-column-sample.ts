import ExcelJS from "exceljs";
import { loadMessages } from "@/i18n/messages";
import { LOCALES, type Locale } from "@/i18n/locales";
import { getColumnRegistry, resolveColumns } from "./journal-columns";
import type { ColumnLabelAliases } from "./journal-column-templates";

/** Built-in header presentation only. Never changes stored/custom column names. */
export async function sampleColumnLabels(code: string, locale: Locale): Promise<Record<string, string>> {
  const messages = await loadMessages(locale);
  const labels = code === "finished_product" ? messages.finishedProduct.columns : messages.journalControls.columnSample;
  return Object.fromEntries(getColumnRegistry(code).map(column => {
    if (!Object.hasOwn(labels, column.key)) throw new Error(`Missing sample column label: ${code}/${column.key}`);
    return [column.key, labels[column.key as keyof typeof labels]];
  }));
}

/** Recognize downloaded headers in any supported language regardless of current UI locale. */
export async function sampleColumnAliases(code: string): Promise<ColumnLabelAliases> {
  const variants = await Promise.all(LOCALES.map(locale => sampleColumnLabels(code, locale)));
  return Object.fromEntries(getColumnRegistry(code).map(column => [column.key, variants.map(labels => labels[column.key])]));
}

export async function createColumnSample(code: string, locale: Locale): Promise<ExcelJS.Workbook> {
  const [messages, labels] = await Promise.all([loadMessages(locale), sampleColumnLabels(code, locale)]);
  const columns = resolveColumns(code, {}).filter(column => !column.hidden && !column.unavailable);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(messages.journalControls.columnSample.sheet);
  sheet.addRow(columns.map(column => labels[column.key]));
  sheet.addRow(columns.map((_, index) => String(index + 1)));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
  sheet.columns.forEach(column => { column.width = 22; });
  return workbook;
}
