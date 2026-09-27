import assert from "node:assert/strict";
import test from "node:test";

import { createCanvas } from "@napi-rs/canvas";
import { jsPDF } from "jspdf";

import { BRAND_QR_CAPTION_TITLE } from "@/lib/brand-qr";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { journalSamplePdfQr } from "@/lib/journal-pdf-qr-link";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { registerJournalUnicodeFont } from "@/lib/pdf-journal-font";
import {
  JOURNAL_HEADER_ROWS_MM,
  JOURNAL_QR_MAX_GROWTH_MM,
  JOURNAL_QR_MIN_MODULE_MM,
  journalQrCellHeight,
  journalQrTile,
  prepareJournalQr,
  stampJournalQr,
  trackPdfInk,
  type JournalPdfQr,
  type PdfBox,
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
const PT_TO_MM = 25.4 / 72;
/** Самый плотный адрес документа (53 модуля): шапка с QR растёт сильнее всего. */
const QR_DOC_LONGEST: JournalPdfQr = {
  url: "https://wesetup.ru/qj/cmf1abcdefghijklmnopqrstu/cleaning_ventilation_checklist/AbCdEfGhIjKl",
};

type Margins = { page: number; top: number; bottom: number; left: number; right: number };
type TextBox = PdfBox & { text: string };
type PageInfo = { margins: Margins; widthMm: number; heightMm: number; texts: TextBox[] };

/**
 * По каждой странице PDF: поля по растру (от края листа до первого тёмного
 * пикселя, любой канал < 235 — рамки, текст, заливки, QR) и текст pdf.js с
 * прямоугольниками строк, мм.
 */
async function inspectPages(pdf: Uint8Array): Promise<PageInfo[]> {
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
    const out: PageInfo[] = [];
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
      const widthMm = base.width * PT_TO_MM;
      const heightMm = base.height * PT_TO_MM;
      const content = await page.getTextContent();
      const texts: TextBox[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const [, , , , e, f] = item.transform as number[];
        const size = Math.hypot((item.transform as number[])[2], (item.transform as number[])[3]) * PT_TO_MM;
        const baseline = heightMm - f * PT_TO_MM;
        texts.push({
          text: item.str,
          x0: e * PT_TO_MM,
          x1: (e + item.width) * PT_TO_MM,
          y0: baseline - size * 0.75,
          y1: baseline + size * 0.2,
        });
      }
      out.push({
        margins: {
          page: n,
          top: y0 / PX_PER_MM,
          bottom: heightMm - (y1 + 1) / PX_PER_MM,
          left: x0 / PX_PER_MM,
          right: widthMm - (x1 + 1) / PX_PER_MM,
        },
        widthMm,
        heightMm,
        texts,
      });
    }
    return out;
  } finally {
    await task.destroy();
  }
}

function assertMargins(label: string, pages: PageInfo[], sides: Array<"top" | "bottom" | "left" | "right">) {
  for (const { margins: m } of pages) {
    for (const side of sides) {
      assert.ok(
        Math.abs(m[side] - M) <= TOL,
        `${label}, стр. ${m.page}: поле ${side} = ${m[side].toFixed(2)} мм, ждём ${M} ± ${TOL} ` +
          `(верх/низ/лево/право ${m.top.toFixed(1)}/${m.bottom.toFixed(1)}/${m.left.toFixed(1)}/${m.right.toFixed(1)})`,
      );
    }
  }
}

const intersects = (a: PdfBox, b: PdfBox) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

test("поле листа — одно значение для всех сторон; снизу у таблиц только полоса под «СТР. X ИЗ N», резерва под QR нет", () => {
  assert.equal(M, 10);
  assert.deepEqual(journalTableMargin(undefined), {
    top: M,
    right: M,
    bottom: M + JOURNAL_FOOTER_TEXT_BAND_MM,
    left: M,
  });
});

test("поля таблицы: чего бланк не задал — поля листа, заданное — как есть", () => {
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

test("«СТР. X ИЗ N» и подвал партнёра — базовой линией на нижнем поле, номер у правого поля, подвал от левого", () => {
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

test("полная страница таблицы (книжный и альбомный лист, документ с QR): снизу поле листа + полоса номера, без резерва", async () => {
  for (const orientation of ["portrait", "landscape"] as const) {
    const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
    const fontName = registerJournalUnicodeFont(doc);
    doc.setFont(fontName, "normal");
    // QR у документа есть — но шапки нет, и таблица начинается с верхнего
    // поля: QR на такой странице не ставится и строк не отнимает.
    prepareJournalQr(doc, QR_DOC_LONGEST.url);
    const tracker = trackPdfInk(doc);
    doc.setFontSize(10);
    const bottomByPage = new Map<number, number>();
    let rowHeight = 0;
    journalAutoTable(doc, {
      startY: M,
      head: [["№", "Сотрудник", "Отметка"]],
      body: Array.from({ length: 90 }, (_, i) => [String(i + 1), `Сотрудник ${i + 1}`, "+"]),
      styles: { font: fontName, fontSize: 9 },
      didDrawCell: (data) => {
        const page = data.pageNumber;
        bottomByPage.set(page, Math.max(bottomByPage.get(page) ?? 0, data.cell.y + data.cell.height));
        rowHeight = Math.max(rowHeight, data.cell.height);
      },
    });
    const pages = doc.getNumberOfPages();
    assert.ok(pages >= 2, "таблица на несколько страниц");
    stampJournalPageNumbers(doc, fontName);
    const placements = stampJournalQr(doc, { ...QR_DOC_LONGEST, fontName, tracker });
    assert.ok(placements.every((p) => p.where === "none"), `${orientation}: QR не лезет на таблицу`);
    const pageHeight = orientation === "portrait" ? 297 : 210;
    const limit = pageHeight - (M + JOURNAL_FOOTER_TEXT_BAND_MM);
    for (let page = 1; page < pages; page += 1) {
      const bottom = bottomByPage.get(page) ?? 0;
      assert.ok(bottom <= limit + 0.01, `${orientation}, стр. ${page}: низ таблицы ${bottom} ниже ${limit}`);
      assert.ok(bottom > limit - rowHeight - 0.01, `${orientation}, стр. ${page}: таблица кончается на ${bottom}, резерв?`);
    }
    // Поля по растру: сверху/слева/справа таблица, снизу «СТР. X ИЗ N» — 10 мм.
    assertMargins(orientation, await inspectPages(new Uint8Array(doc.output("arraybuffer"))), [
      "top",
      "bottom",
      "left",
      "right",
    ]);
  }
});

test("образцы журналов: QR в шапке на каждой странице с шапкой — внутри полей, вровень с правой рамкой, текст шапки не задет", async () => {
  // Гигиена — «Периодичность контроля» и повтор шапки на стр. 2; медкнижки —
  // три листа с повтором шапки; чек-лист уборки — свой заголовок над шапкой
  // и повтор на 2..N; холодильники — самое длинное название журнала;
  // санитарный день — стр. 2 без шапки (QR там нет).
  for (const code of ["hygiene", "med_books", "cleaning_ventilation_checklist", "cold_equipment_control", "sanitary_day_control"]) {
    for (const qr of [journalSamplePdfQr("https://wesetup.ru", code), QR_DOC_LONGEST]) {
      const label = `${code} (${qr.url.includes("/qj/") ? "53 модуля" : "образец"})`;
      const rendered = renderJournalDocumentPdf({ ...buildJournalSampleInput(code), qr });
      const placements = rendered.qrPlacements ?? [];
      const pages = await inspectPages(new Uint8Array(rendered.buffer));
      assert.equal(placements.length, pages.length, label);
      pages.forEach((page, index) => {
        const p = placements[index];
        const hasHeader = page.texts.some((t) => t.text.includes("СИСТЕМА ХАССП"));
        assert.equal(p.where === "header", hasHeader, `${label}, стр. ${index + 1}: QR в шапке = шапка есть`);
        if (!p.box) return;
        // Внутри полей листа; ячейка шапки — вровень с правой рамкой шапки
        // (= правый край таблицы, правое поле 10 мм).
        assert.ok(p.box.x0 >= M && p.box.y0 >= M - 1e-6, `${label}: плитка внутри полей`);
        assert.ok(p.box.x1 <= page.widthMm - M + 1e-6 && p.box.y1 <= page.heightMm - M, `${label}: плитка внутри полей`);
        if (p.slot) assert.ok(Math.abs(p.slot.x1 - (page.widthMm - M)) < 0.01, `${label}: ячейка QR у правого поля`);
        // Модуль не меньше 0,35 мм, шапка выросла не больше чем на 4 мм.
        assert.ok(p.module >= JOURNAL_QR_MIN_MODULE_MM - 1e-9, `${label}: модуль ${p.module}`);
        if (p.slot) {
          assert.ok(p.slot.y1 - p.slot.y0 >= JOURNAL_HEADER_ROWS_MM - 1e-6);
          // Плитка — вся ячейка внутри линий, окно кода в ней; самой плитке
          // нужно не больше строк шапки + 4 мм (выше — только из-за переноса названия).
          assert.ok(p.window && p.window.y0 >= p.box.y0 - 1e-9 && p.window.y1 <= p.box.y1 + 1e-9, `${label}: окно кода в ячейке`);
          assert.ok(journalQrCellHeight(journalQrTile(qr.url)) <= JOURNAL_HEADER_ROWS_MM + JOURNAL_QR_MAX_GROWTH_MM, `${label}: плитка по высоте шапки`);
        }
        // Ни одна строка текста страницы (кроме слова в полосе самой плитки)
        // не заходит на плитку.
        const own = new Set([BRAND_QR_CAPTION_TITLE]);
        const hit = page.texts.find((t) => !own.has(t.text.trim()) && intersects(t, p.box!));
        assert.equal(hit, undefined, `${label}, стр. ${index + 1}: текст «${hit?.text}» на месте QR`);
      });
      // Поля: сверху, слева и справа — 10 мм (шапка и таблица от поля до
      // поля, QR внутри рамки шапки); снизу — не меньше поля листа.
      assertMargins(label, pages, ["top", "left", "right"]);
      for (const { margins } of pages) assert.ok(margins.bottom >= M - TOL, `${label}: низ ${margins.bottom}`);
    }
  }
});
