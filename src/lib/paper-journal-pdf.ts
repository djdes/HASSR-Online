import fs from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { PaperJournal } from "@/lib/sphere-journal-rules";
import { stampPartnerPdfFooter, type PdfFooterBrand } from "@/lib/pdf-page-labels";
import { formatJournalPeriodLabel } from "@/lib/journal-document-title";
import {
  reserveJournalQrBottomMargin,
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
 * Шрифт — тот же DejaVu, что и у остальных PDF: helvetica в jsPDF не
 * знает кириллицы и печатает кракозябры (см. document-pdf.ts).
 */

const FONT_CANDIDATES = [
  path.join(process.cwd(), "src", "lib", "pdf-fonts", "DejaVuSans.ttf"),
  "C:\\Windows\\Fonts\\arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
];

function loadUnicodeFont(doc: jsPDF): string {
  const fontPath = FONT_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!fontPath) return "helvetica";
  const base64 = fs.readFileSync(fontPath).toString("base64");
  doc.addFileToVFS("paper-unicode.ttf", base64);
  doc.addFont("paper-unicode.ttf", "PaperUnicode", "normal");
  doc.addFont("paper-unicode.ttf", "PaperUnicode", "bold");
  return "PaperUnicode";
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
   * QR с подписью в свободном углу каждой страницы (публичный бланк с
   * сайта: копирайт и QR на /qb). Нет — бланк как раньше (кабинет).
   */
  qr?: JournalPdfQr | null;
};

export function renderPaperJournalPdf(params: PaperJournalPdfParams): Buffer {
  return renderPaperJournalPdfDetailed(params).buffer;
}

/**
 * С QR — до двух проходов, как у электронных журналов (document-pdf):
 * сначала как есть; если хоть на одной странице угол занят таблицей —
 * с нижним полем таблицы под QR. Лишний лист ради угла не добавляем.
 */
export function renderPaperJournalPdfDetailed(params: PaperJournalPdfParams): {
  buffer: Buffer;
  qrPlacements?: JournalQrPlacement[];
} {
  if (!params.qr?.url) return renderPaperJournalPdfPass(params, false);
  const first = renderPaperJournalPdfPass(params, false);
  const firstPlacements = first.qrPlacements ?? [];
  if (firstPlacements.every((p) => p.bottomRow && !p.overlap)) return first;
  const second = renderPaperJournalPdfPass(params, true);
  const secondPlacements = second.qrPlacements ?? [];
  const firstFree = firstPlacements.every((p) => !p.overlap);
  const secondFree = secondPlacements.every((p) => !p.overlap);
  if (firstFree && (!secondFree || secondPlacements.length > firstPlacements.length)) return first;
  return second;
}

function renderPaperJournalPdfPass(
  params: PaperJournalPdfParams,
  reserveQrBottom: boolean,
): { buffer: Buffer; qrPlacements?: JournalQrPlacement[] } {
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
  // QR: учёт нарисованного бланком — до первой отрисовки.
  const qr = params.qr?.url ? params.qr : null;
  const inkTracker = qr ? trackPdfInk(doc) : null;
  if (qr && reserveQrBottom) reserveJournalQrBottomMargin(doc);

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
      ? `Бланк для бумажного ведения. Электронная форма не применяется — ${journal.law.label}.`
      : `Бланк для бумажного ведения — ${journal.law.label}.`,
    pageWidth / 2,
    noteY,
    { align: "center" },
  );
  doc.setTextColor(0, 0, 0);

  const head = [["№", ...journal.columns]];
  const filled = rows.map((row, index) => [
    String(index + 1),
    ...journal.columns.map((_, column) => row[column] ?? ""),
  ]);
  const blanks = Array.from({ length: blankRows }, (_, index) => [
    String(filled.length + index + 1),
    ...journal.columns.map(() => ""),
  ]);

  autoTable(doc, {
    head,
    body: [...filled, ...blanks],
    startY: noteY + 6,
    styles: {
      font,
      fontSize: 8,
      cellPadding: 2.4,
      lineColor: [11, 16, 36],
      lineWidth: 0.2,
      textColor: [11, 16, 36],
      minCellHeight: 9,
    },
    headStyles: {
      font,
      fontStyle: "bold",
      fillColor: [238, 241, 255],
      textColor: [11, 16, 36],
      fontSize: 8,
    },
    columnStyles: { 0: { cellWidth: 10, halign: "center" } },
    margin: { left: 10, right: 10 },
  });

  stampPartnerPdfFooter(doc, branding, font);
  // QR — последним: встаёт только на свободное место страницы.
  const qrPlacements = qr ? stampJournalQr(doc, { ...qr, fontName: font, tracker: inkTracker }) : undefined;

  return {
    buffer: Buffer.from(doc.output("arraybuffer")),
    ...(qrPlacements ? { qrPlacements } : {}),
  };
}
