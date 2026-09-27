import type { jsPDF } from "jspdf";
import type { RowInput } from "jspdf-autotable";
import { JOURNAL_SHEET_MARGIN_MM, journalCapHeightMm } from "@/lib/pdf-journal-sheet";
import { journalAutoTable as autoTable } from "@/lib/pdf-journal-table";
import {
  getItemNumber,
  mergeSdcEntries,
  normalizeSdcConfig,
  resolveSdcSignerName,
} from "@/lib/sanitary-day-checklist-document";

type BasicUser = {
  id: string;
  name: string;
  role: string;
};

type EntryItem = {
  date: Date;
  data: unknown;
};

function formatRuDate(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const y = date.getUTCFullYear();
  return `${d}.${m}.${y}`;
}

export function drawSanitaryDayChecklistPdf(
  doc: jsPDF,
  params: {
    organizationName: string;
    title: string;
    dateFrom: Date;
    config: unknown;
    entries: EntryItem[];
    users: BasicUser[];
    /**
     * Общая шапка ХАССП бланков (`drawJournalHeader` из document-pdf):
     * штамп с полями `marginX` и верхом `top`, возвращает Y нижней
     * границы. Раньше здесь была своя таблица-штамп другого вида.
     */
    drawHeader: (doc: jsPDF, options: { marginX: number; top: number }) => number;
    /**
     * Нижняя граница содержимого страницы (мм от верха листа): ниже —
     * нижнее поле с QR и «СТР. X ИЗ N». По умолчанию — поле листа.
     */
    contentBottom?: number;
  }
) {
  const config = normalizeSdcConfig(params.config);

  // Отметки всех записей документа — тот же helper, что и на экране.
  const mergedMarks = mergeSdcEntries(params.entries).marks;

  const pageWidth = doc.internal.pageSize.getWidth();
  // Поле листа — одно со всех сторон (как у остальных бланков).
  const margin = JOURNAL_SHEET_MARGIN_MM;

  // ─── Шапка ХАССП — общая для всех бланков, на верхнем поле листа ───
  const lastY = params.drawHeader(doc, { marginX: margin, top: margin });

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(10);
  doc.text("ДАТА ПРОВЕДЕНИЯ", margin, lastY + 7);
  doc.setFont("JournalUnicode", "normal");
  doc.text(formatRuDate(params.dateFrom), pageWidth - margin, lastY + 7, {
    align: "right",
  });

  // ─── Общие принципы block ───
  let cursorY = lastY + 11;
  if (config.generalPrinciples.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      theme: "grid",
      styles: {
        font: "JournalUnicode",
        fontSize: 9,
        lineColor: [0, 0, 0],
        lineWidth: 0.2,
        cellPadding: 2,
      },
      body: [
        [
          {
            content: "ОБЩИЕ ПРИНЦИПЫ",
            styles: { fontStyle: "bold", halign: "left" },
          },
        ],
        ...config.generalPrinciples.map(
          (p) => [{ content: `• ${p}` }] as RowInput
        ),
      ],
      margin: { left: margin, right: margin },
    });
    cursorY =
      (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable
        ?.finalY ?? cursorY + 10;
  }

  // ─── Checklist table grouped by zone ───
  const body: RowInput[] = [];
  config.zones.forEach((zone, zoneIndex) => {
    body.push([
      {
        content: `${zoneIndex + 1}. ${zone.name.toUpperCase()}`,
        colSpan: 3,
        styles: {
          fontStyle: "bold",
          halign: "center",
          fillColor: [232, 232, 232],
        },
      },
    ]);
    const zoneItems = config.items.filter((it) => it.zoneId === zone.id);
    for (const item of zoneItems) {
      body.push([
        { content: getItemNumber(config, item), styles: { halign: "center" } },
        { content: item.text },
        {
          content: mergedMarks[item.id] || "",
          styles: { halign: "center" },
        },
      ]);
    }
  });

  autoTable(doc, {
    startY: cursorY + 4,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 9,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      cellPadding: 1.8,
      valign: "middle",
    },
    head: [
      [
        { content: "№ п/п", styles: { halign: "center" } },
        { content: "Действия", styles: { halign: "center" } },
        { content: "Отметка времени", styles: { halign: "center" } },
      ],
    ],
    body,
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: "auto" },
      2: { cellWidth: 34 },
    },
    margin: { left: margin, right: margin },
  });

  // ─── Signatures ───
  const finalY =
    (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable
      ?.finalY ?? cursorY + 40;
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentBottom = params.contentBottom ?? pageHeight - margin;
  // Подписи — целиком над нижним полем листа (блок: две строки через 8 мм
  // и линия под второй). Как и раньше, при нехватке места блок
  // подтягивается к таблице, но не ближе 7 мм и не на неё (раньше его
  // прижимало к `pageHeight - 20` поверх строк); не помещается и так —
  // переходит на новую страницу.
  doc.setFontSize(10);
  const SIGNATURES_HEIGHT = 9;
  let sigY = Math.max(finalY + 7, Math.min(finalY + 14, contentBottom - SIGNATURES_HEIGHT));
  if (sigY + SIGNATURES_HEIGHT > contentBottom) {
    doc.addPage();
    sigY = margin + journalCapHeightMm(doc);
  }

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(10);
  doc.text("ВЫПОЛНИЛ:", margin, sigY);
  doc.setFont("JournalUnicode", "normal");
  // Имя — по id, чтобы переименование сотрудника не оставляло бланк пустым.
  doc.text(
    resolveSdcSignerName(
      config.responsibleUserId,
      config.responsibleName,
      params.users
    ) || "_______________________",
    margin + 36,
    sigY
  );
  doc.line(margin + 36, sigY + 1, margin + 120, sigY + 1);

  doc.setFont("JournalUnicode", "bold");
  doc.text("ПРОВЕРИЛ:", margin, sigY + 8);
  doc.setFont("JournalUnicode", "normal");
  doc.text(
    resolveSdcSignerName(config.checkerUserId, config.checkerName, params.users) ||
      "_______________________",
    margin + 36,
    sigY + 8
  );
  doc.line(margin + 36, sigY + 9, margin + 120, sigY + 9);
}
