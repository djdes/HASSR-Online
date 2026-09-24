import { PDFDocument } from "pdf-lib";

import {
  ORDER_SCAN_ERRORS,
  ORDER_SCAN_MAX_BYTES,
  sniffOrderScanType,
  type OrderScanMime,
} from "@/lib/journal-order-scans";

/**
 * Серверная часть сканов приказов к журналу: проверка PDF/картинки при
 * загрузке и склейка печати журнала со сканами (pdf-lib).
 */

/**
 * Полная проверка загружаемого файла: размер, тип по содержимому, что
 * PDF открывается без пароля, а картинка встраивается в PDF (иначе печать
 * журнала потом молча потеряла бы приказ).
 */
export async function validateOrderScanFile(input: {
  bytes: Uint8Array;
  fileName: string;
  declaredMime: string;
}): Promise<{ ok: true; mime: OrderScanMime; pages: number } | { ok: false; error: string }> {
  if (input.bytes.length === 0) return { ok: false, error: ORDER_SCAN_ERRORS.empty };
  if (input.bytes.length > ORDER_SCAN_MAX_BYTES) return { ok: false, error: ORDER_SCAN_ERRORS.tooBig };
  const sniffed = sniffOrderScanType(input.bytes, input.fileName, input.declaredMime);
  if (!sniffed.ok) return sniffed;
  if (sniffed.mime === "application/pdf") {
    try {
      const pdf = await PDFDocument.load(input.bytes);
      const pages = pdf.getPageCount();
      if (pages === 0) return { ok: false, error: ORDER_SCAN_ERRORS.pdf };
      return { ok: true, mime: sniffed.mime, pages };
    } catch {
      return { ok: false, error: ORDER_SCAN_ERRORS.pdf };
    }
  }
  try {
    const probe = await PDFDocument.create();
    if (sniffed.mime === "image/jpeg") await probe.embedJpg(input.bytes);
    else await probe.embedPng(input.bytes);
    return { ok: true, mime: sniffed.mime, pages: 1 };
  } catch {
    return { ok: false, error: ORDER_SCAN_ERRORS.image };
  }
}

export type OrderScanForPdf = {
  id: string;
  title: string;
  mimeType: string;
  content: Uint8Array;
};

/** A4 в пунктах PDF и поля 10 мм. */
const A4_SHORT = 595.28;
const A4_LONG = 841.89;
const MARGIN = 28.35;

/**
 * Страницы приказов после страниц журнала: PDF-скан — его страницами как
 * есть, картинка — на своём листе A4 (ориентация по картинке) с полями, по
 * размеру листа. QR-штамп журнала сюда не попадает: склейка идёт после
 * рендера. Файл, который не открылся, пропускается — печать журнала из-за
 * него не падает; его название возвращается в `skipped`.
 */
export async function appendOrderScansToPdf(
  journalPdf: Uint8Array,
  scans: ReadonlyArray<OrderScanForPdf>
): Promise<{ buffer: Buffer; appendedPages: number; skipped: string[] }> {
  if (scans.length === 0) return { buffer: Buffer.from(journalPdf), appendedPages: 0, skipped: [] };
  const out = await PDFDocument.load(journalPdf);
  let appendedPages = 0;
  const skipped: string[] = [];
  for (const scan of scans) {
    try {
      if (scan.mimeType === "application/pdf") {
        const source = await PDFDocument.load(scan.content);
        const pages = await out.copyPages(source, source.getPageIndices());
        for (const page of pages) out.addPage(page);
        appendedPages += pages.length;
        continue;
      }
      const image =
        scan.mimeType === "image/png" ? await out.embedPng(scan.content) : await out.embedJpg(scan.content);
      const landscape = image.width > image.height;
      const pageWidth = landscape ? A4_LONG : A4_SHORT;
      const pageHeight = landscape ? A4_SHORT : A4_LONG;
      const scale = Math.min((pageWidth - 2 * MARGIN) / image.width, (pageHeight - 2 * MARGIN) / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      const page = out.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
      appendedPages += 1;
    } catch (error) {
      console.warn("[order-scans] scan skipped in print", scan.id, error instanceof Error ? error.message : error);
      skipped.push(scan.title);
    }
  }
  return { buffer: Buffer.from(await out.save()), appendedPages, skipped };
}
