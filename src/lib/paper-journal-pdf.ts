import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { PaperJournal } from "@/lib/sphere-journal-rules";
import { stampPartnerPdfFooter, type PdfFooterBrand } from "@/lib/pdf-page-labels";
import { formatJournalPeriodLabel } from "@/lib/journal-document-title";
import { journalPrintableText, registerJournalUnicodeFont } from "@/lib/pdf-journal-font";
import {
  prepareJournalQr,
  stampJournalQr,
  trackPdfInk,
  type JournalPdfQr,
  type JournalQrPlacement,
} from "@/lib/pdf-journal-qr";

/**
 * Бланк бумажного журнала для печати.
 *
 * Инструктажи по охране труда закон разрешает вести только на бумаге
 * (ТК РФ ст. 22.1), пожарные журналы — можно и электронно с подписью.
 * И тем и другим нужен готовый лист с шапкой организации и нужными
 * колонками, поэтому бланк даём всем, но обещаем разное: пометку
 * «электронная форма не принимается» печатаем только там, где это
 * правда (`journal.paperOnly`). Пустые строки печатаем всегда —
 * заполнять их будут ручкой.
 *
 * Шрифт — тот же, что у электронных журналов (`pdf-journal-font.ts`:
 * Liberation Serif с настоящим жирным): helvetica в jsPDF не знает
 * кириллицы и печатает кракозябры. Раньше здесь был свой DejaVu Sans, и
 * «жирный» был тем же обычным файлом.
 */

function loadUnicodeFont(doc: jsPDF): string {
  return registerJournalUnicodeFont(doc);
}

export type PaperJournalOrg = {
  name: string;
  inn?: string | null;
  address?: string | null;
};

export type PaperJournalPdfParams = {
  journal: PaperJournal;
  organization: PaperJournalOrg;
  /** Заполненные строки. Пусто — печатаем чистый бланк. */
  rows?: string[][];
  /** Сколько пустых строк добавить под рукописное заполнение. */
  blankRows?: number;
  /** White-label партнёра — подпись в подвале каждой страницы. */
  branding?: PdfFooterBrand | null;
  /**
   * Период документа `YYYY-MM-DD`. Есть только у документа со страницы
   * журнала; черновик и публичный семпл печатаются без него.
   */
  period?: { from: string | null; to: string | null } | null;
  /**
   * Фирменный QR справа в заголовке бланка и копирайт внизу каждой страницы
   * (публичный бланк с сайта: QR на /qb). Нет — бланк как раньше (кабинет).
   */
  qr?: JournalPdfQr | null;
};

export function renderPaperJournalPdf(params: PaperJournalPdfParams): Buffer {
  return renderPaperJournalPdfDetailed(params).buffer;
}

/**
 * QR — справа вверху, в зоне заголовка над таблицей (правый край вровень с
 * таблицей): таблицу он не сдвигает и строк не занимает. На продолжениях
 * таблица начинается сверху — там QR нет (`stampJournalQr`: угол занят).
 */
export function renderPaperJournalPdfDetailed(params: PaperJournalPdfParams): {
  buffer: Buffer;
  qrPlacements?: JournalQrPlacement[];
} {
  const {
    journal,
    organization,
    rows = [],
    blankRows = 18,
    branding = null,
    period = null,
  } = params;
  const periodLabel = period ? formatJournalPeriodLabel(period.from, period.to) : "";

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const font = loadUnicodeFont(doc);
  const pageWidth = doc.internal.pageSize.getWidth();
  // QR: плитка под адрес и учёт нарисованного бланком — до первой отрисовки.
  const qr = params.qr?.url ? params.qr : null;
  if (qr) prepareJournalQr(doc, qr.url);
  const inkTracker = qr ? trackPdfInk(doc) : null;

  doc.setFont(font, "bold");
  doc.setFontSize(13);
  doc.text(organization.name, pageWidth / 2, 14, { align: "center" });

  const subtitleParts = [
    organization.inn ? `ИНН ${organization.inn}` : null,
    organization.address || null,
  ].filter(Boolean);
  if (subtitleParts.length > 0) {
    doc.setFont(font, "normal");
    doc.setFontSize(9);
    doc.text(subtitleParts.join(" · "), pageWidth / 2, 20, { align: "center" });
  }

  doc.setFont(font, "bold");
  doc.setFontSize(15);
  doc.text(journal.name, pageWidth / 2, 30, { align: "center" });

  // Период — под названием, как в шапке документа на экране. Без него
  // (черновик, семпл) все строки ниже остаются на прежних местах.
  const noteY = periodLabel ? 40 : 36;
  if (periodLabel) {
    doc.setFont(font, "normal");
    doc.setFontSize(9);
    doc.text(`Период: ${periodLabel}`, pageWidth / 2, 35, { align: "center" });
  }

  // Красная пометка: человек не должен решить, что этот бланк заменяет
  // электронный журнал — он именно для бумаги.
  doc.setFont(font, "normal");
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  // Размер штрафа с бланка убран: это лист, который кладут в папку и
  // показывают инспектору, и наша приписка про санкции там — самодеятельность.
  // Бланк должен выглядеть как бланк. Норму права оставляем: она объясняет,
  // почему журнал именно бумажный, и в документе уместна.
  doc.text(
    journal.paperOnly
      ? `Журнал для ведения на бумаге. Электронная форма не применяется — ${journal.law.label}.`
      : `Журнал для ведения на бумаге — ${journal.law.label}.`,
    pageWidth / 2,
    noteY,
    { align: "center" },
  );
  doc.setTextColor(0, 0, 0);

  const head = [["№", ...journal.columns]];
  const filled = rows.map((row, index) => [
    String(index + 1),
    ...journal.columns.map((_, column) => journalPrintableText(row[column] ?? "")),
  ]);
  const blanks = Array.from({ length: blankRows }, (_, index) => [
    String(filled.length + index + 1),
    ...journal.columns.map(() => ""),
  ]);

  autoTable(doc, {
    head,
    body: [...filled, ...blanks],
    startY: noteY + 6,
    // Только чёрный и серый (у заведений ч/б принтеры): линии и текст —
    // чёрные, шапка — светло-серая, как у таблиц электронных бланков.
    styles: {
      font,
      fontSize: 8,
      cellPadding: 2.4,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      minCellHeight: 9,
    },
    headStyles: {
      font,
      fontStyle: "bold",
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontSize: 8,
    },
    columnStyles: { 0: { cellWidth: 10, halign: "center" } },
    margin: { left: 10, right: 10 },
  });

  stampPartnerPdfFooter(doc, branding, font);
  // QR — последним: в правый верхний угол страницы, если он свободен
  // (на первой — справа от заголовка, над таблицей).
  const qrPlacements = qr ? stampJournalQr(doc, { ...qr, fontName: font, tracker: inkTracker }) : undefined;

  return {
    buffer: Buffer.from(doc.output("arraybuffer")),
    ...(qrPlacements ? { qrPlacements } : {}),
  };
}
