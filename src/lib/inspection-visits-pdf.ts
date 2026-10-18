import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { inspectionVisitBasisRu, inspectionVisitKindLabelRu } from "@/lib/inspection-visits";
import { registerJournalUnicodeFont } from "@/lib/pdf-journal-font";

/**
 * «Журнал посещений» для архива проверки: одна таблица за период — когда,
 * кто (ФИО, должность), орган, вид проверки, основание и что приложено.
 * Сами сканы лежат рядом в папке архива.
 */

export type InspectionVisitPdfRow = {
  visitedAt: Date;
  inspectorName: string;
  inspectorPosition: string | null;
  authority: string;
  kind: string;
  kindNote: string | null;
  basisNumber: string | null;
  basisDate: Date | null;
  source: string;
  createdByName: string | null;
  fileCount: number;
};

function dateTimeRu(date: Date, timeZone: string): string {
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildInspectionVisitsPdf(input: {
  organizationName: string;
  periodFrom: Date;
  periodTo: Date;
  timeZone: string;
  rows: InspectionVisitPdfRow[];
}): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const font = registerJournalUnicodeFont(doc);
  doc.setFont(font, "bold");
  doc.setFontSize(16);
  doc.text("Журнал посещений проверяющих", 148.5, 18, { align: "center" });
  doc.setFont(font, "normal");
  doc.setFontSize(11);
  doc.text(`${input.organizationName} · ${ymd(input.periodFrom)} — ${ymd(input.periodTo)}`, 148.5, 25, {
    align: "center",
  });

  if (input.rows.length === 0) {
    doc.setFontSize(12);
    doc.text("За период посещений не записано.", 148.5, 45, { align: "center" });
    return Buffer.from(doc.output("arraybuffer"));
  }

  autoTable(doc, {
    startY: 32,
    head: [["№", "Дата и время", "Проверяющий", "Орган контроля", "Вид проверки", "Основание", "Внесено", "Скан"]],
    body: input.rows.map((row, index) => [
      String(index + 1),
      dateTimeRu(row.visitedAt, input.timeZone),
      row.inspectorPosition ? `${row.inspectorName}, ${row.inspectorPosition}` : row.inspectorName,
      row.authority,
      inspectionVisitKindLabelRu(row.kind, row.kindNote),
      inspectionVisitBasisRu(row.basisNumber, row.basisDate),
      row.source === "inspector" ? "проверяющим по QR" : row.createdByName ? `руководством (${row.createdByName})` : "руководством",
      row.fileCount > 0 ? `${row.fileCount} файл.` : "нет",
    ]),
    theme: "grid",
    styles: { font, fontSize: 9, cellPadding: 1.5, overflow: "linebreak" },
    headStyles: { font, fillColor: [242, 242, 242], textColor: 30 },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 28 },
      2: { cellWidth: 52 },
      3: { cellWidth: 56 },
      4: { cellWidth: 34 },
      5: { cellWidth: 36 },
      6: { cellWidth: 36 },
      7: { cellWidth: 17 },
    },
    margin: { left: 10, right: 10 },
  });

  return Buffer.from(doc.output("arraybuffer"));
}
