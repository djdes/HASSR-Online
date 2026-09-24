import type { jsPDF } from "jspdf";

import { PLATFORM_BADGE_TEXT } from "@/lib/partners/validation";

/**
 * Единая нумерация страниц печатных бланков — «СТР. X ИЗ N».
 *
 * Раньше каждая `draw<Journal>Pdf` рисовала подпись СРАЗУ, когда общее
 * число страниц ещё не известно, поэтому в шапке стоял хардкод
 * («СТР. 1 ИЗ 1» на трёхстраничном журнале) либо ячейка оставалась пустой.
 *
 * Теперь отрисовщик только РЕГИСТРИРУЕТ прямоугольник ячейки, а текст
 * ставится одним проходом `stampJournalPageNumbers` после вёрстки, когда
 * `doc.getNumberOfPages()` уже честный. Страницы без шапки получают
 * подпись в правом нижнем углу.
 *
 * Состояние модульное — как `activeControlPeriodicity` в `document-pdf.ts`:
 * значение сбрасывается в начале генерации, а вся отрисовка jsPDF
 * синхронна, поэтому параллельные запросы не пересекаются.
 */
export type PageLabelSlot = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  maxWidth: number;
  fontSize: number;
  fontStyle: "normal" | "bold";
};

let pageLabelSlots: PageLabelSlot[] = [];

export function resetPageLabelSlots() {
  pageLabelSlots = [];
}

function currentPageNumber(doc: jsPDF): number {
  const withInfo = doc as jsPDF & {
    getCurrentPageInfo?: () => { pageNumber: number };
  };
  return withInfo.getCurrentPageInfo?.().pageNumber ?? doc.getNumberOfPages();
}

export function registerPageLabelSlot(
  doc: jsPDF,
  slot: Omit<PageLabelSlot, "page">
) {
  pageLabelSlots.push({ ...slot, page: currentPageNumber(doc) });
}

function drawCenteredLabel(
  doc: jsPDF,
  text: string,
  slot: PageLabelSlot
) {
  const lines = doc.splitTextToSize(text, slot.maxWidth) as string[];
  const lineHeight = 4.6;
  const startY = slot.y + slot.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    doc.text(line, slot.x + slot.width / 2, startY + index * lineHeight, {
      align: "center",
    });
  });
}

export function stampJournalPageNumbers(
  doc: jsPDF,
  fontName = "JournalUnicode",
  options: {
    /**
     * Отступ правого края подписи «СТР. X ИЗ N» на странице без шапки
     * (мм от правого края листа). По умолчанию 14; с QR-кодом в углу —
     * левее QR-блока (`journalQrFooterInset`).
     */
    fallbackRightInset?: number;
  } = {}
) {
  const fallbackRightInset = options.fallbackRightInset ?? 14;
  const totalPages = doc.getNumberOfPages();
  const byPage = new Map<number, PageLabelSlot>();
  for (const slot of pageLabelSlots) {
    if (!byPage.has(slot.page)) byPage.set(slot.page, slot);
  }

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    doc.setPage(pageNumber);
    // Размер листа — свой у каждой страницы (приложение бывает альбомным).
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const label = `СТР. ${pageNumber} ИЗ ${totalPages}`;
    const slot = byPage.get(pageNumber);
    doc.setFont(fontName, slot?.fontStyle ?? "bold");
    doc.setFontSize(slot?.fontSize ?? 10);
    if (slot) {
      drawCenteredLabel(doc, label, slot);
    } else {
      doc.text(label, pageWidth - fallbackRightInset, pageHeight - 8, { align: "right" });
    }
  }

  doc.setFont(fontName, "normal");
  doc.setFontSize(10);
}

/**
 * Подвал white-label: подпись партнёра из брендинга (≤120 символов) и
 * обязательная плашка «Работает на платформе WeSetup». Печатается на
 * КАЖДОЙ странице бланка слева внизу, не пересекаясь с «СТР. X ИЗ N»
 * справа. Для организаций без партнёра (или скрывших брендинг) подвал
 * не печатается — бланк выглядит как раньше.
 */
export type PdfFooterBrand = {
  brandName: string;
  pdfSignature: string | null;
};

export function partnerPdfFooterText(brand: PdfFooterBrand): string {
  const signature = brand.pdfSignature?.trim() || `Сопровождение: ${brand.brandName}`;
  return `${signature} · ${PLATFORM_BADGE_TEXT}`;
}

export function stampPartnerPdfFooter(
  doc: jsPDF,
  brand: PdfFooterBrand | null | undefined,
  fontName = "JournalUnicode",
  options: {
    /**
     * Сколько места справа (мм) оставить под «СТР. X ИЗ N» (и QR-код в
     * углу, если он печатается). По умолчанию 48.
     */
    rightReserve?: number;
  } = {}
) {
  if (!brand) return;
  const totalPages = doc.getNumberOfPages();
  const rightReserve = options.rightReserve ?? 48;
  const text = partnerPdfFooterText(brand);

  doc.setFont(fontName, "normal");
  doc.setFontSize(7);
  doc.setTextColor(111, 114, 130);
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    doc.setPage(pageNumber);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    // Справа оставляем место под «СТР. X ИЗ N» на страницах без шапки.
    const maxWidth = pageWidth - 14 - rightReserve;
    const lines = (doc.splitTextToSize(text, maxWidth) as string[]).slice(0, 2);
    lines.forEach((line, index) => {
      const y = pageHeight - 8 - (lines.length - 1 - index) * 3.4;
      doc.text(line, 14, y);
    });
  }
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
}
