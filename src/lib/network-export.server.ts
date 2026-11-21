import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { formatNumber, type Locale } from "@/i18n/locales";
import { translatorFor } from "@/i18n/translator";
import { registerUnicodeFont } from "@/lib/closing-documents/pdf-font";
import {
  exportCellText,
  networkExportFileName,
  networkPeriodTable,
  networkTodayTable,
  type NetworkExportFormat,
  type NetworkExportLabels,
  type NetworkExportTable,
} from "@/lib/network-export";
import type { NetworkPeriod } from "@/lib/network-period";
import type { NetworkPeriodSummary } from "@/lib/network-period.server";
import { formatNetworkDateTime, formatNetworkDay } from "@/lib/network-summary";
import type { NetworkSummary } from "@/lib/network-summary.server";
import { orgTodayKey } from "@/lib/timezone";

/**
 * Файлы выгрузки «Сети» (серия E, Р6): Excel (`exceljs`) и PDF (`jspdf` +
 * `jspdf-autotable` с DejaVu — штатные шрифты jsPDF кириллицы не знают), как
 * остальные выгрузки. Таблицу собирает `network-export.ts`.
 */

/** Узкий неразрывный пробел из `Intl` в PDF заменяем обычным неразрывным. */
const pdfText = (value: string) => value.replace(/ /g, " ");

export async function renderNetworkXlsx(table: NetworkExportTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WeSetup";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(table.sheetName.slice(0, 31) || "Sheet1");
  const width = table.columns.length;

  sheet.addRow([table.title]).font = { bold: true, size: 14 };
  sheet.addRow([table.subtitle]).font = { color: { argb: "FF5F6170" } };
  sheet.addRow([]);
  const header = sheet.addRow(table.columns.map((column) => column.header));
  header.font = { bold: true };
  header.alignment = { vertical: "middle", wrapText: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };
  });
  const headerRow = header.number;

  for (const row of [...table.rows, table.totals]) {
    const added = sheet.addRow([...row]);
    table.columns.forEach((column, index) => {
      const cell = added.getCell(index + 1);
      if (typeof cell.value !== "number") return;
      cell.numFmt = column.kind === "rub" ? '#,##0 "₽"' : column.kind === "percent" ? '0"%"' : "#,##0";
      cell.alignment = { horizontal: "right" };
    });
  }
  sheet.getRow(sheet.rowCount).font = { bold: true };
  table.columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });
  sheet.views = [{ state: "frozen", ySplit: headerRow }];
  sheet.addRow([]);
  if (table.note) sheet.addRow([table.note]).font = { italic: true, color: { argb: "FF5F6170" } };
  sheet.addRow([table.generated]).font = { color: { argb: "FF5F6170" } };
  if (width > 1) sheet.mergeCells(1, 1, 1, width);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function renderNetworkPdf(table: NetworkExportTable, formatNumber: (value: number) => string): Buffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const font = registerUnicodeFont(doc);
  doc.setFont(font, "normal");
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  let y = 15;
  const heading = (text: string, size: number) => {
    doc.setFontSize(size);
    const lines: string[] = doc.splitTextToSize(pdfText(text), pageWidth - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * size * 0.4 + 3;
  };
  heading(table.title, 14);
  heading(table.subtitle, 10);

  const text = (row: NetworkExportTable["rows"][number]) =>
    row.map((cell, index) => pdfText(exportCellText(cell, table.columns[index]?.kind ?? "text", formatNumber)));
  const numericColumns = Object.fromEntries(
    table.columns.flatMap((column, index) => (column.kind === "text" ? [] : [[index, { halign: "right" as const }]])),
  );

  autoTable(doc, {
    startY: y,
    head: [table.columns.map((column) => pdfText(column.header))],
    body: table.rows.map(text),
    foot: [text(table.totals)],
    theme: "grid",
    styles: { font, fontStyle: "normal", fontSize: 9, cellPadding: 2, overflow: "linebreak", valign: "middle", lineColor: [0, 0, 0], textColor: [0, 0, 0] },
    // Серая шапка с чёрным текстом — как у остальных выгрузок (ч/б принтер).
    headStyles: { font, fontStyle: "normal", fillColor: [224, 224, 224], textColor: 0 },
    footStyles: { font, fontStyle: "normal", fillColor: [245, 245, 245], textColor: 0 },
    columnStyles: numericColumns,
    showFoot: "lastPage",
    margin: { top: 15, bottom: 20, left: margin, right: margin },
    didDrawPage: (data) => {
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFont(font, "normal");
      doc.setFontSize(8);
      doc.setTextColor(128, 128, 128);
      doc.text(pdfText(table.generated), margin, pageHeight - 10);
      doc.text(String(data.pageNumber), pageWidth - margin, pageHeight - 10, { align: "right" });
      doc.setTextColor(0, 0, 0);
    },
  });

  if (table.note) {
    const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y;
    doc.setFontSize(8);
    doc.setTextColor(95, 97, 112);
    const lines: string[] = doc.splitTextToSize(pdfText(table.note), pageWidth - margin * 2);
    const pageHeight = doc.internal.pageSize.getHeight();
    if (finalY + 6 + lines.length * 4 > pageHeight - 20) {
      doc.addPage();
      doc.text(lines, margin, 20);
    } else {
      doc.text(lines, margin, finalY + 6);
    }
    doc.setTextColor(0, 0, 0);
  }

  return Buffer.from(doc.output("arraybuffer"));
}

const MIME: Record<NetworkExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

/** День периода («2026-11-14», Москва) — полдень, чтобы формат по Москве не съехал на сутки. */
const dayOf = (dayKey: string) => new Date(`${dayKey}T12:00:00.000Z`);

/** Подписи выгрузки на языке человека (как у отчётов — `translatorFor`). */
async function exportLabels(locale: Locale, now: Date, subtitle: (t: Awaited<ReturnType<typeof translatorFor>>) => string, withNote: boolean): Promise<NetworkExportLabels> {
  const t = await translatorFor(locale);
  return {
    title: t("settingsManagement.network.export.title"),
    sheetName: t("settingsManagement.network.export.sheet"),
    subtitle: subtitle(t),
    generated: t("settingsManagement.network.export.generated", { date: formatNetworkDateTime(now, locale) }),
    total: t("settingsManagement.network.export.total"),
    note: withNote ? t("settingsManagement.network.period.hint") : null,
    columns: {
      organization: t("settingsManagement.network.columns.organization"),
      journals: t("settingsManagement.network.columns.journals"),
      status: t("settingsManagement.network.export.status"),
      balance: t("settingsManagement.network.columns.balance"),
      trial: t("settingsManagement.network.columns.trial"),
      exchange: t("settingsManagement.network.columns.exchange"),
      filledDays: t("settingsManagement.network.period.columns.filled"),
      percent: t("settingsManagement.network.export.percent"),
      records: t("settingsManagement.network.period.columns.records"),
    },
    ofValue: (done, total) => t("settingsManagement.network.journals.value", { done: String(done), total: String(total) }),
    unknown: t("settingsManagement.network.journals.unknown"),
    todayStatus: {
      done: t("settingsManagement.network.journals.status.done"),
      partial: t("settingsManagement.network.journals.status.partial"),
      none: t("settingsManagement.network.journals.status.none"),
      empty: t("settingsManagement.network.journals.status.empty"),
      unknown: t("settingsManagement.network.journals.status.unknown"),
    },
    periodStatus: {
      done: t("settingsManagement.network.period.status.done"),
      partial: t("settingsManagement.network.period.status.partial"),
      none: t("settingsManagement.network.period.status.none"),
      empty: t("settingsManagement.network.period.status.empty"),
      unknown: t("settingsManagement.network.period.status.unknown"),
    },
    trial: (row) =>
      row.trial.state === "trial"
        ? t("settingsManagement.network.trial.active", { date: formatNetworkDay(row.trial.lastDay, locale) })
        : row.trial.state === "locked"
          ? t("settingsManagement.network.trial.locked")
          : t("settingsManagement.network.trial.none"),
    exchange: (row) =>
      row.lastExchangeAt ? formatNetworkDateTime(row.lastExchangeAt, locale) : t("settingsManagement.network.exchange.never"),
    marks: (row) => [
      ...(row.current ? [t("settingsManagement.network.current")] : []),
      ...(row.deletionRequested ? [t("settingsManagement.network.deleting")] : []),
    ],
  };
}

/**
 * Файл выгрузки: «Сегодня» — из `loadNetworkSummary`, 7/30 дней — из
 * `loadNetworkPeriod`. Имя — по дню выгрузки по Москве.
 */
export async function networkExportFile(input: {
  format: NetworkExportFormat;
  period: NetworkPeriod;
  locale: Locale;
  now: Date;
  today: NetworkSummary;
  periodSummary: NetworkPeriodSummary | null;
}): Promise<{ body: Buffer; filename: string; contentType: string; table: NetworkExportTable }> {
  const { locale, now, periodSummary } = input;
  const table = periodSummary
    ? networkPeriodTable({
        rows: periodSummary.rows,
        totals: periodSummary.totals,
        labels: await exportLabels(
          locale,
          now,
          (t) =>
            t("settingsManagement.network.export.range", {
              from: formatNetworkDay(dayOf(periodSummary.range.from), locale),
              to: formatNetworkDay(dayOf(periodSummary.range.to), locale),
              count: periodSummary.days,
            }),
          true,
        ),
      })
    : networkTodayTable({
        rows: input.today.rows,
        totals: input.today.totals,
        labels: await exportLabels(locale, now, (t) => t("settingsManagement.network.export.today", { date: formatNetworkDay(now, locale) }), false),
      });
  const body =
    input.format === "xlsx" ? await renderNetworkXlsx(table) : renderNetworkPdf(table, (value) => formatNumber(locale, value));
  return {
    body,
    filename: networkExportFileName(periodSummary ? input.period : "today", input.format, orgTodayKey("Europe/Moscow", now)),
    contentType: MIME[input.format],
    table,
  };
}
