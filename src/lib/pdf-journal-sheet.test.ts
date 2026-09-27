import assert from "node:assert/strict";
import test from "node:test";

import { createCanvas } from "@napi-rs/canvas";
import { jsPDF } from "jspdf";

import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { journalSamplePdfQr } from "@/lib/journal-pdf-qr-link";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { registerJournalUnicodeFont } from "@/lib/pdf-journal-font";
import {
  JOURNAL_QR_BOTTOM_MM,
  JOURNAL_QR_BOTTOM_RESERVE_MM,
  JOURNAL_QR_DEFAULT_RIGHT_MARGIN_MM,
  journalQrFooterInset,
  journalQrRightEdges,
  reserveJournalQrBottomMargin,
  stampJournalQr,
  trackPdfInk,
} from "@/lib/pdf-journal-qr";
import {
  JOURNAL_FOOTER_TEXT_BAND_MM,
  JOURNAL_SHEET_MARGIN_MM,
  journalCapHeightMm,
  journalSheetTopBaseline,
} from "@/lib/pdf-journal-sheet";
import { journalAutoTable, journalTableMargin } from "@/lib/pdf-journal-table";
import { stampJournalPageNumbers, stampPartnerPdfFooter } from "@/lib/pdf-page-labels";

const M = JOURNAL_SHEET_MARGIN_MM;
/** Допуск замера по растру, мм (72 dpi — 0,35 мм на пиксель). */
const TOL = 1;
const DPI = 72;
const PX_PER_MM = DPI / 25.4;
const QR_LINES = ["Заполнение электронного журнала", "wesetup.ru"];
const QR_URL = "https://wesetup.ru/journals-info/hygiene";

type Margins = { page: number; top: number; bottom: number; left: number; right: number };

/**
 * Поля каждой страницы PDF по растру: от края листа до первого тёмного
 * пикселя (любой канал < 235 — рамки, текст, заливки, QR и его подпись).
 */
async function pageMargins(pdf: Uint8Array): Promise<Margins[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = await task.promise;
    const out: Margins[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: DPI / 72 });
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport } as Parameters<
        typeof page.render
      >[0]).promise;
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;
      let x0 = width;
      let x1 = -1;
      let y0 = height;
      let y1 = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          if (Math.min(data[i], data[i + 1], data[i + 2]) < 235) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      const widthMm = (base.width / 72) * 25.4;
      const heightMm = (base.height / 72) * 25.4;
      out.push({
        page: n,
        top: y0 / PX_PER_MM,
        bottom: heightMm - (y1 + 1) / PX_PER_MM,
        left: x0 / PX_PER_MM,
        right: widthMm - (x1 + 1) / PX_PER_MM,
      });
    }
    return out;
  } finally {
    await task.destroy();
  }
}

function assertSymmetric(label: string, margins: Margins[]) {
  for (const m of margins) {
    for (const side of ["top", "bottom", "left", "right"] as const) {
      assert.ok(
        Math.abs(m[side] - M) <= TOL,
        `${label}, стр. ${m.page}: поле ${side} = ${m[side].toFixed(2)} мм, ждём ${M} ± ${TOL} ` +
          `(верх/низ/лево/право ${m.top.toFixed(1)}/${m.bottom.toFixed(1)}/${m.left.toFixed(1)}/${m.right.toFixed(1)})`,
      );
    }
  }
}

test("поле листа — одно значение для всех сторон: QR в углу стоит на том же поле снизу и справа", () => {
  assert.equal(M, 10);
  assert.equal(JOURNAL_QR_BOTTOM_MM, M);
  assert.equal(JOURNAL_QR_DEFAULT_RIGHT_MARGIN_MM, M);
  // Резерв таблиц под угол: поле листа + QR 13 мм + тихая зона + половина линии.
  assert.ok(Math.abs(JOURNAL_QR_BOTTOM_RESERVE_MM - (M + 13 + 1.3 + 0.1)) < 1e-9);
});

test("поля таблицы: чего бланк не задал — поля листа, заданное — как есть", () => {
  assert.deepEqual(journalTableMargin(undefined), {
    top: M,
    right: M,
    bottom: M + JOURNAL_FOOTER_TEXT_BAND_MM,
    left: M,
  });
  // autoTable сам подставил бы 14,1 мм в недостающие стороны.
  assert.deepEqual(journalTableMargin({ left: 14, right: 14 }), {
    top: M,
    right: 14,
    bottom: M + JOURNAL_FOOTER_TEXT_BAND_MM,
    left: 14,
  });
  assert.deepEqual(journalTableMargin({ top: 50, bottom: 25 }), { top: 50, right: M, bottom: 25, left: M });
  assert.deepEqual(journalTableMargin({ vertical: 5, horizontal: 7 }), { top: 5, right: 7, bottom: 5, left: 7 });
  assert.equal(journalTableMargin(12), 12);
  assert.deepEqual(journalTableMargin([1, 2, 3, 4]), [1, 2, 3, 4]);
});

test("верх первой строки на верхнем поле: базовая линия = поле + высота прописных", () => {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(26);
  assert.ok(Math.abs(journalSheetTopBaseline(doc) - (M + journalCapHeightMm(doc))) < 1e-9);
  assert.ok(journalCapHeightMm(doc) > 6.5 && journalCapHeightMm(doc) < 7, `26 pt → ${journalCapHeightMm(doc)} мм`);
});

test("«СТР. X ИЗ N» и подвал партнёра — базовой линией на нижнем поле, подвал от левого поля", () => {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const fontName = registerJournalUnicodeFont(doc);
  doc.addPage("a4", "portrait");
  const calls: Array<{ text: string; x: number; y: number; page: number }> = [];
  const original = doc.text.bind(doc);
  (doc as unknown as { text: (...args: unknown[]) => jsPDF }).text = (...args: unknown[]) => {
    const [text, x, y] = args as [string, number, number];
    const page = (doc as jsPDF & { getCurrentPageInfo: () => { pageNumber: number } }).getCurrentPageInfo().pageNumber;
    calls.push({ text: String(text), x, y, page });
    return (original as (...a: unknown[]) => jsPDF)(...args);
  };
  stampJournalPageNumbers(doc, fontName);
  stampPartnerPdfFooter(doc, { brandName: "Партнёр", pdfSignature: "Сопровождение: ООО «Партнёр»" }, fontName);
  const heights = [210, 297];
  const widths = [297, 210];
  for (const page of [1, 2]) {
    const label = calls.find((call) => call.page === page && call.text.startsWith("СТР."));
    assert.ok(label, `подпись страницы ${page}`);
    assert.ok(Math.abs(label.y - (heights[page - 1] - M)) < 0.01, `стр. ${page}: базовая линия ${label.y}`);
    assert.ok(Math.abs(label.x - (widths[page - 1] - M)) < 0.01, `стр. ${page}: правый край ${label.x}`);
    const footer = calls.filter((call) => call.page === page && call.text.includes("Сопровождение"));
    assert.equal(footer.length, 1);
    assert.ok(Math.abs(footer[0].y - (heights[page - 1] - M)) < 0.01, `подвал стр. ${page}: ${footer[0].y}`);
    assert.equal(footer[0].x, M);
  }
});

test("книжный и альбомный лист: таблица на несколько страниц + QR + «СТР. X ИЗ N» — поля 10 мм со всех сторон на каждой странице", async () => {
  for (const orientation of ["portrait", "landscape"] as const) {
    const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
    const fontName = registerJournalUnicodeFont(doc);
    doc.setFont(fontName, "normal");
    const tracker = trackPdfInk(doc);
    reserveJournalQrBottomMargin(doc, JOURNAL_QR_BOTTOM_RESERVE_MM);
    doc.setFontSize(10);
    journalAutoTable(doc, {
      // Первая строка — на верхнем поле, продолжения — тоже (поле по умолчанию).
      startY: M,
      head: [["№", "Сотрудник", "Отметка"]],
      body: Array.from({ length: 90 }, (_, i) => [String(i + 1), `Сотрудник ${i + 1}`, "+"]),
      styles: { font: fontName, fontSize: 9 },
    });
    assert.ok(doc.getNumberOfPages() >= 2, "таблица на несколько страниц");
    const edges = journalQrRightEdges(doc, tracker);
    stampJournalPageNumbers(doc, fontName, {
      fallbackRightInset: (page) => {
        doc.setPage(page);
        return journalQrFooterInset(doc, QR_LINES, fontName, doc.internal.pageSize.getWidth() - edges[page - 1]);
      },
    });
    const placements = stampJournalQr(doc, { url: QR_URL, lines: QR_LINES, fontName, tracker, rightEdges: edges });
    assert.ok(placements.every((p) => p.bottomRow && !p.moved && !p.overlap), `${orientation}: QR в углу на каждой странице`);
    assertSymmetric(orientation, await pageMargins(new Uint8Array(doc.output("arraybuffer"))));
  }
});

test("образцы журналов: верх = низ = лево = право (10 ± 1 мм) на первой странице и продолжениях", async () => {
  // Гигиена — шапка без крупного заголовка (раньше 28 мм сверху) и её
  // повтор на продолжении; бракераж — крупный заголовок над шапкой;
  // чек-лист уборки — свой заголовок и повтор шапки на 2..N; УФ-установка —
  // лист, заполненный целиком; медкнижки — три листа с повтором шапки.
  for (const code of ["hygiene", "finished_product", "cleaning_ventilation_checklist", "uv_lamp_runtime", "med_books"]) {
    const input = { ...buildJournalSampleInput(code), qr: journalSamplePdfQr("https://wesetup.ru", code) };
    const rendered = renderJournalDocumentPdf(input);
    const placements = rendered.qrPlacements ?? [];
    assert.ok(placements.every((p) => p.bottomRow && !p.overlap), `${code}: QR в нижнем углу на каждой странице`);
    const margins = await pageMargins(new Uint8Array(rendered.buffer));
    if (code === "hygiene" || code === "cleaning_ventilation_checklist" || code === "med_books") {
      assert.ok(margins.length >= 2, `${code}: есть страница-продолжение`);
    }
    assertSymmetric(code, margins);
  }
});
