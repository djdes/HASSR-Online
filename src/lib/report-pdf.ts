import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { registerUnicodeFont } from "@/lib/closing-documents/pdf-font";
import { formatReportDay, formatReportDateTime, type ReportTable } from "@/lib/report-export";
import type { Locale } from "@/i18n/locales";
import { translatorFor } from "@/i18n/translator";

/** Pure document rendering: locale and business timezone are fixed by the caller. */
export async function renderJournalPDF(params: {
  organizationName: string;
  templateName: string;
  dateFrom: string;
  dateTo: string;
  timeZone: string;
  table: ReportTable;
  emptyMessage: string;
  locale: Locale;
  generatedAt?: Date;
}): Promise<Buffer> {
  const { organizationName, templateName, dateFrom, dateTo, timeZone, table, emptyMessage, locale } = params;
  const t = await translatorFor(locale);
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });
  const font = registerUnicodeFont(doc);
  doc.setFont(font, "normal");

  const pageWidth = doc.internal.pageSize.getWidth();

  let headerY = 15;
  const heading = (text: string, size: number) => {
    doc.setFontSize(size);
    const lines: string[] = doc.splitTextToSize(text, pageWidth - 28);
    doc.text(lines, pageWidth / 2, headerY, { align: "center" });
    headerY += lines.length * size * 0.4 + 3;
  };
  heading(organizationName, 14);
  heading(templateName, 12);
  const periodText = t("reports.period", { from: formatDate(dateFrom, locale), to: formatDate(dateTo, locale) });
  heading(periodText, 10);

  const head = [["№", ...table.headers]];
  const body = table.isEmpty
    ? [[{ content: emptyMessage, colSpan: table.headers.length + 1 }]]
    : table.rows.map((row, index) => [String(index + 1), ...row]);

  autoTable(doc, {
    startY: headerY,
    head,
    body,
    theme: "grid",
    styles: {
      font,
      fontStyle: "normal",
      fontSize: 7,
      cellPadding: 2,
      overflow: "linebreak",
      valign: "middle",
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
    },
    // Шапка — серая с чёрным текстом: синяя с белым на ч/б принтере
    // печаталась тёмной плашкой.
    headStyles: {
      font,
      fontStyle: "normal",
      fillColor: [224, 224, 224],
      textColor: 0,
      fontSize: 7,
      halign: "center",
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
    columnStyles: {
      0: { cellWidth: 10 },
    },
    margin: { top: 35, bottom: 25, left: 14, right: 14 },
    didDrawPage: (data) => {
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFont(font, "normal");
      doc.setFontSize(8);
      doc.setTextColor(128, 128, 128);

      const footerLeft = t("reports.generated", { date: formatReportDateTime(params.generatedAt ?? new Date(), timeZone, locale) });
      doc.text(footerLeft, 14, pageHeight - 10);

      doc.text(`${data.pageNumber}`, pageWidth - 14, pageHeight - 10, { align: "right" });

      doc.setTextColor(0, 0, 0);
    },
  });

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}

function formatDate(dateStr: string, locale: Locale): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!match) return dateStr;
  return formatReportDay(new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`), locale);
}
