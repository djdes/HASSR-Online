import { jsPDF } from "jspdf";
import { PDFDocument } from "pdf-lib";

import { registerJournalUnicodeFont } from "@/lib/pdf-journal-font";

/**
 * Один PDF из нескольких (2026-11-01, «Пришла проверка» одним файлом):
 * обложка, содержание с номерами страниц, затем части по порядку.
 * Склейка — pdf-lib (страницы копируются как есть), содержание — jsPDF с
 * кириллическим шрифтом журналов. Часть, которую не удалось прочитать,
 * пропускается и попадает в `skipped`, а не роняет весь файл.
 */

export type PdfPart = { title: string; bytes: Uint8Array };
export type TocEntry = { title: string; startPage: number; pages: number };
export type MergedPdf = { bytes: Uint8Array; entries: TocEntry[]; skipped: string[]; totalPages: number };

/** Строк содержания на странице A4. */
export const TOC_ROWS_PER_PAGE = 32;

/** Страницы содержания: номер страницы каждой части с учётом обложки и самого содержания. */
export function tocEntries(coverPages: number, tocPages: number, parts: Array<{ title: string; pages: number }>): TocEntry[] {
  let page = coverPages + tocPages + 1;
  return parts.map((part) => {
    const entry = { title: part.title, startPage: page, pages: part.pages };
    page += part.pages;
    return entry;
  });
}

export function renderTocPdf(title: string, entries: TocEntry[], notes: string[] = []): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const font = registerJournalUnicodeFont(doc);
  const left = 20;
  const right = 190;
  let y = 24;
  doc.setFont(font, "bold");
  doc.setFontSize(16);
  doc.text(title, left, y);
  y += 10;
  doc.setFont(font, "normal");
  doc.setFontSize(10.5);
  let row = 0;
  for (const entry of entries) {
    if (row > 0 && row % TOC_ROWS_PER_PAGE === 0) {
      doc.addPage();
      y = 20;
    }
    const label = doc.splitTextToSize(entry.title, right - left - 18)[0] as string;
    doc.text(label, left, y);
    doc.text(String(entry.startPage), right, y, { align: "right" });
    y += 7.5;
    row += 1;
  }
  if (notes.length > 0) {
    y += 4;
    doc.setFontSize(9.5);
    doc.setTextColor(110, 114, 130);
    for (const note of notes) {
      const lines = doc.splitTextToSize(note, right - left) as string[];
      if (y + lines.length * 5 > 285) {
        doc.addPage();
        y = 20;
      }
      doc.text(lines, left, y);
      y += lines.length * 5 + 2;
    }
  }
  return new Uint8Array(doc.output("arraybuffer"));
}

export async function mergePdfParts(input: {
  cover: PdfPart | null;
  parts: PdfPart[];
  tocTitle: string;
  notes?: string[];
}): Promise<MergedPdf> {
  const skipped: string[] = [];
  const load = async (part: PdfPart) => {
    try {
      return await PDFDocument.load(part.bytes, { ignoreEncryption: true });
    } catch {
      skipped.push(part.title);
      return null;
    }
  };
  const cover = input.cover ? await load(input.cover) : null;
  const loaded: Array<{ title: string; doc: PDFDocument }> = [];
  for (const part of input.parts) {
    const doc = await load(part);
    if (doc && doc.getPageCount() > 0) loaded.push({ title: part.title, doc });
  }
  const coverPages = cover?.getPageCount() ?? 0;
  const shape = loaded.map((part) => ({ title: part.title, pages: part.doc.getPageCount() }));
  const notes = [...(input.notes ?? []), ...skipped.map((title) => `Не вошло в файл (не удалось прочитать): ${title}`)];

  // Число страниц содержания зависит от числа строк; уточняем, если вышло иначе.
  let tocPages = Math.max(1, Math.ceil(shape.length / TOC_ROWS_PER_PAGE));
  let entries = tocEntries(coverPages, tocPages, shape);
  let toc = await PDFDocument.load(renderTocPdf(input.tocTitle, entries, notes));
  if (toc.getPageCount() !== tocPages) {
    tocPages = toc.getPageCount();
    entries = tocEntries(coverPages, tocPages, shape);
    toc = await PDFDocument.load(renderTocPdf(input.tocTitle, entries, notes));
  }

  const merged = await PDFDocument.create();
  for (const source of [cover, toc, ...loaded.map((part) => part.doc)]) {
    if (!source) continue;
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  const bytes = await merged.save();
  return { bytes, entries, skipped, totalPages: merged.getPageCount() };
}
