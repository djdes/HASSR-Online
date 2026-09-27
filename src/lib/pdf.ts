import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { registerUnicodeFont } from "@/lib/closing-documents/pdf-font";
import { loadReportTable } from "@/lib/report-export-data";
import { REPORT_EMPTY_MESSAGE, formatReportDateTime } from "@/lib/report-export";

/**
 * PDF-выгрузка журнала за период (/reports → «Скачать PDF»).
 *
 * Содержимое то же, что у Excel: строки собирает `loadReportTable`
 * (документные записи + легаси `JournalEntry`). Раньше здесь читался
 * только легаси `JournalEntry` и PDF всегда выходил пустым, а штатный
 * шрифт jsPDF не знает кириллицы — отсюда регистрация DejaVu.
 */
export async function generateJournalPDF(params: {
  templateCode: string;
  organizationId: string;
  organizationName: string;
  dateFrom: string;
  dateTo: string;
  areaId?: string;
}): Promise<Buffer> {
  const { templateCode, organizationId, organizationName, dateFrom, dateTo, areaId } = params;

  const loaded = await loadReportTable({
    templateCode,
    organizationId,
    dateFrom,
    dateTo,
    areaId,
  });
  if (!loaded) {
    throw new Error("Шаблон не найден");
  }
  const { templateName, timeZone, table } = loaded;

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });
  const font = registerUnicodeFont(doc);
  doc.setFont(font, "normal");

  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(14);
  doc.text(organizationName, pageWidth / 2, 15, { align: "center" });

  doc.setFontSize(12);
  doc.text(templateName, pageWidth / 2, 23, { align: "center" });

  doc.setFontSize(10);
  const periodText = `Период: ${formatDate(dateFrom)} - ${formatDate(dateTo)}`;
  doc.text(periodText, pageWidth / 2, 30, { align: "center" });

  const head = [["№", ...table.headers]];
  const body = table.isEmpty
    ? [[{ content: REPORT_EMPTY_MESSAGE, colSpan: table.headers.length + 1 }]]
    : table.rows.map((row, index) => [String(index + 1), ...row]);

  autoTable(doc, {
    startY: 35,
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

      const footerLeft = `Сгенерировано в WeSetup | ${formatReportDateTime(new Date(), timeZone)}`;
      doc.text(footerLeft, 14, pageHeight - 10);

      doc.text(`${data.pageNumber}`, pageWidth - 14, pageHeight - 10, { align: "right" });

      doc.setTextColor(0, 0, 0);
    },
  });

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}

function formatDate(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!match) return dateStr;
  return `${match[3]}.${match[2]}.${match[1]}`;
}
