import assert from "node:assert/strict";
import test from "node:test";

import { createCanvas } from "@napi-rs/canvas";
import { jsPDF } from "jspdf";

import { BRAND_QR_CAPTION_SITE, BRAND_QR_CAPTION_TITLE, brandQrLayout } from "@/lib/brand-qr";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { registerJournalUnicodeFont } from "@/lib/pdf-journal-font";
import {
  JOURNAL_HEADER_ROWS_MM,
  JOURNAL_QR_CELL_PAD_MM,
  JOURNAL_QR_MAX_GROWTH_MM,
  JOURNAL_QR_MAX_MODULES,
  JOURNAL_QR_MIN_MODULE_MM,
  JOURNAL_QR_PAD_MM,
  JOURNAL_QR_TARGET_MODULE_MM,
  findJournalQrCorner,
  journalQrCellHeight,
  journalQrCellWidth,
  journalQrContentRight,
  journalQrMatrix,
  journalQrTile,
  journalQrTileOf,
  prepareJournalQr,
  registerJournalQrSlot,
  stampJournalQr,
  trackPdfInk,
} from "@/lib/pdf-journal-qr";
import { JOURNAL_SHEET_MARGIN_MM } from "@/lib/pdf-journal-sheet";

const M = JOURNAL_SHEET_MARGIN_MM;
/** Образец бланка — короткий адрес (37 модулей). */
const URL_SAMPLE = "https://wesetup.ru/journals-info/hygiene";
/** Адрес документа с кодом журнала до 23 символов — 49 модулей (так у 42 журналов из 45). */
const URL_DOC = "https://wesetup.ru/qj/cmf1abcdefghijklmnopqrstu/hygiene/AbCdEfGhIjKl";
/** Самый плотный адрес документа: /qj/<cuid>/<код 30 символов>/<подпись> — 53 модуля. */
const URL_DOC_LONGEST = "https://wesetup.ru/qj/cmf1abcdefghijklmnopqrstu/cleaning_ventilation_checklist/AbCdEfGhIjKl";

test("плитка: короткий адрес — в две строки шапки (20 мм), шапка не растёт; модуль ≥ 0,35 мм", () => {
  const tile = journalQrTile(URL_SAMPLE);
  assert.equal(tile.modules, 37);
  assert.ok(Math.abs(journalQrCellHeight(tile) - JOURNAL_HEADER_ROWS_MM) < 1e-9, `ячейка ${journalQrCellHeight(tile)}`);
  assert.ok(tile.module >= JOURNAL_QR_MIN_MODULE_MM, `модуль ${tile.module}`);
  // Пропорции фирменной плитки: ширина — матрица + тихая зона, высота — с плашкой.
  const layout = brandQrLayout(URL_SAMPLE);
  assert.ok(Math.abs(tile.width / tile.height - layout.width / layout.height) < 1e-9);
  assert.ok(Math.abs(journalQrCellWidth(tile) - (tile.width + 2 * JOURNAL_QR_CELL_PAD_MM)) < 1e-9);
});

test("плитка: адрес документа (49 модулей) — шапка выше ровно до модуля 0,365 мм", () => {
  const tile = journalQrTile(URL_DOC);
  assert.equal(tile.modules, 49);
  assert.ok(Math.abs(tile.module - JOURNAL_QR_TARGET_MODULE_MM) < 1e-9, `модуль ${tile.module}`);
  const growth = journalQrCellHeight(tile) - JOURNAL_HEADER_ROWS_MM;
  assert.ok(growth > 3 && growth < JOURNAL_QR_MAX_GROWTH_MM, `рост шапки ${growth}`);
  // 41 модуль в 20 мм — уже крупнее: шапка не растёт.
  const sample = journalQrTile("https://wesetup.ru/journals-info/cold_equipment_control");
  assert.equal(sample.modules, 41);
  assert.ok(sample.module > JOURNAL_QR_TARGET_MODULE_MM);
  assert.ok(Math.abs(journalQrCellHeight(sample) - JOURNAL_HEADER_ROWS_MM) < 1e-9);
});

test("плитка: самый плотный адрес (53 модуля) — шапка выше ровно на 4 мм, модуль не меньше 0,35 мм", () => {
  const tile = journalQrTile(URL_DOC_LONGEST);
  assert.equal(tile.modules, 53);
  assert.ok(tile.module >= JOURNAL_QR_MIN_MODULE_MM - 1e-9 && tile.module < JOURNAL_QR_TARGET_MODULE_MM, `модуль ${tile.module}`);
  const growth = journalQrCellHeight(tile) - JOURNAL_HEADER_ROWS_MM;
  assert.ok(Math.abs(growth - JOURNAL_QR_MAX_GROWTH_MM) < 1e-9, `рост шапки ${growth}`);
  assert.equal(JOURNAL_QR_MAX_MODULES, 53, "версия 9 — самая плотная, что помещается");
});

test("плитка: плотнее 53 модулей — ошибка, а не нечитаемый QR", () => {
  const url = `https://wesetup.ru/qb/${"A".repeat(130)}`;
  assert.ok(journalQrMatrix(url).modules.size > JOURNAL_QR_MAX_MODULES);
  assert.throws(() => journalQrTile(url), /слишком плотный/);
});

test("матрица — полный фирменный QR с коррекцией H", () => {
  const qr = journalQrMatrix(URL_SAMPLE);
  assert.equal(qr.errorCorrectionLevel.bit, 2, "H");
  assert.equal(brandQrLayout(URL_SAMPLE).errorCorrection, "H");
});

test("учёт чернил: текст, ячейки и контур записываются по страницам; stop() снимает обёртки", () => {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const originalText = doc.text;
  const tracker = trackPdfInk(doc);
  assert.notEqual(doc.text, originalText, "обёртка стоит");
  doc.setFontSize(10);
  doc.text("Подпись справа", 200, 280, { align: "right" });
  doc.addPage("a4", "landscape");
  doc.rect(10, 10, 100, 50, "F");
  doc.rect(0, 0, 297, 210); // рамка листа — только контур
  doc.line(5, 100, 50, 100);

  const p1 = tracker.boxes(1);
  assert.equal(p1.length, 1);
  assert.ok(p1[0].x1 <= 200.01 && p1[0].x0 < 200 - 10, "правое выравнивание учтено");
  assert.ok(p1[0].y0 < 280 && p1[0].y1 > 280);

  const p2 = tracker.boxes(2);
  assert.ok(p2.some((b) => b.x0 === 10 && b.y0 === 10 && b.x1 === 110 && b.y1 === 60), "заливка — целиком");
  // Рамка листа не занимает середину страницы.
  const middle = { x0: 140, y0: 90, x1: 160, y1: 95 };
  assert.ok(!p2.some((b) => b.x0 < middle.x1 && middle.x0 < b.x1 && b.y0 < middle.y1 && middle.y0 < b.y1));

  tracker.stop();
  assert.equal(doc.text, originalText, "обёртка снята");
  doc.text("после stop", 20, 20);
  assert.equal(tracker.boxes(2).length, p2.length, "после stop не пишется");
});

test("страница без шапки: плитка в правом верхнем углу, если он свободен; занят — QR нет", () => {
  const tile = { width: 16.62, height: 19.7 };
  // Пусто — на верхнем и правом поле листа.
  assert.deepEqual(findJournalQrCorner({ pageWidth: 297, tile, boxes: [] }), {
    x0: 297 - M - tile.width,
    y0: M,
    x1: 297 - M,
    y1: M + tile.height,
  });
  // Таблица с верхнего поля — угол занят: строки QR не сдвигает.
  assert.equal(findJournalQrCorner({ pageWidth: 297, tile, boxes: [{ x0: M, y0: M, x1: 297 - M, y1: 150 }] }), null);
  // Таблица ниже плитки с зазором — место есть; вровень с правым краем таблицы.
  const below = M + tile.height + JOURNAL_QR_PAD_MM + 0.1;
  const spot = findJournalQrCorner({
    pageWidth: 297,
    tile,
    boxes: [{ x0: 14, y0: below, x1: 283, y1: 180 }],
    rightEdge: 283,
  });
  assert.ok(spot);
  assert.ok(Math.abs(spot.x1 - 283) < 1e-9);
  // Текст ближе тихой зоны — занято.
  assert.equal(
    findJournalQrCorner({ pageWidth: 297, tile, boxes: [{ x0: 260, y0: M + tile.height + 0.5, x1: 280, y1: 40 }] }),
    null,
  );
});

test("граница содержимого: максимум правых краёв, пусто — правое поле листа, не за зоной непечати", () => {
  assert.equal(journalQrContentRight([], 297), 297 - M);
  assert.equal(journalQrContentRight([{ x0: 10, y0: 10, x1: 30, y1: 20 }], 297), 297 - M, "содержимое только слева");
  assert.equal(
    journalQrContentRight(
      [
        { x0: 10, y0: 10, x1: 273, y1: 20 },
        { x0: 10, y0: 30, x1: 283.1, y1: 150 },
      ],
      297,
    ),
    283.1,
  );
  // Таблица шире листа (за зоной непечати) не считается.
  assert.equal(
    journalQrContentRight(
      [
        { x0: 10, y0: 10, x1: 287.1, y1: 60 },
        { x0: 10, y0: 70, x1: 310, y1: 90 },
      ],
      297,
    ),
    287.1,
  );
});

type Raster = { width: number; height: number; data: Uint8ClampedArray; pxPerMm: number };

async function rasterPage(pdf: Uint8Array, pageNumber: number, dpi: number): Promise<Raster> {
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
    const page = await (await task.promise).getPage(pageNumber);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport } as Parameters<
      typeof page.render
    >[0]).promise;
    return {
      width: canvas.width,
      height: canvas.height,
      data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      pxPerMm: dpi / 25.4,
    };
  } finally {
    await task.destroy();
  }
}

/** Средняя яркость 3 × 3 пикселя вокруг точки (мм). */
function luminanceAt(r: Raster, xMm: number, yMm: number): number {
  let sum = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = Math.min(r.width - 1, Math.max(0, Math.floor(xMm * r.pxPerMm) + dx));
      const y = Math.min(r.height - 1, Math.max(0, Math.floor(yMm * r.pxPerMm) + dy));
      const i = (y * r.width + x) * 4;
      sum += 0.299 * r.data[i] + 0.587 * r.data[i + 1] + 0.114 * r.data[i + 2];
    }
  }
  return sum / 9;
}

test("штамп: плитка в ячейке шапки каждой страницы (книжной и альбомной), модули на местах, строк не занимает", async () => {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const fontName = registerJournalUnicodeFont(doc);
  const tile = prepareJournalQr(doc, URL_DOC_LONGEST);
  assert.equal(journalQrTileOf(doc), tile);
  const tracker = trackPdfInk(doc);
  // Стр. 1 (альбомная) и 2 (книжная) — «шапка» регистрирует ячейку справа
  // вровень с правым полем; стр. 3 — таблица с верхнего поля, шапки нет.
  const cellFor = (pageWidth: number) => ({
    x0: pageWidth - M - journalQrCellWidth(tile),
    y0: M,
    x1: pageWidth - M,
    y1: M + journalQrCellHeight(tile) + 6, // строки выше плитки (перенос названия)
  });
  registerJournalQrSlot(doc, cellFor(297));
  doc.addPage("a4", "portrait");
  registerJournalQrSlot(doc, cellFor(210.0015));
  doc.addPage("a4", "landscape");
  doc.setLineWidth(0.2);
  doc.rect(M, M, 277, 150);
  const placements = stampJournalQr(doc, { url: URL_DOC_LONGEST, fontName, tracker });

  assert.deepEqual(
    placements.map((p) => p.where),
    ["header", "header", "none"],
  );
  for (const p of placements.slice(0, 2)) {
    assert.ok(p.box && p.slot);
    // По центру ячейки; правый край — в поле ячейки от рамки шапки.
    assert.ok(Math.abs(p.slot.x1 - p.box.x1 - JOURNAL_QR_CELL_PAD_MM) < 1e-9, `стр. ${p.page}: правый край ${p.box.x1}`);
    assert.ok(Math.abs(p.box.y0 - p.slot.y0 - (p.slot.y1 - p.box.y1)) < 1e-9, "по центру ячейки по высоте");
    assert.ok(p.box.x0 >= M && p.box.y0 >= M, "внутри полей листа");
    assert.equal(p.modules, 53);
  }
  assert.equal(placements[2].box, null);
  assert.equal(tracker.boxes(1).length, 0, "штамп не учитывается как чернила бланка");

  // Растр 600 dpi: центры модулей совпадают с матрицей, плашка тёмная.
  const layout = brandQrLayout(URL_DOC_LONGEST);
  const pdf = new Uint8Array(doc.output("arraybuffer"));
  for (const p of placements.slice(0, 2)) {
    const r = await rasterPage(pdf, p.page, 600);
    const u = tile.module;
    const pad = layout.pad!;
    let mismatches = 0;
    for (let row = 0; row < layout.size; row += 1) {
      for (let col = 0; col < layout.size; col += 1) {
        const mx = layout.quiet + col + 0.5;
        const my = layout.quiet + row + 0.5;
        if (mx >= pad.x && mx <= pad.x + pad.w && my >= pad.y && my <= pad.y + pad.h) continue; // знак сайта
        const cx = p.box!.x0 + (layout.quiet + col + 0.5) * u;
        const cy = p.box!.y0 + (layout.quiet + row + 0.5) * u;
        if (luminanceAt(r, cx, cy) < 128 !== layout.plain(row, col)) mismatches += 1;
      }
    }
    assert.equal(mismatches, 0, `стр. ${p.page}: модули по растру`);
    const plate = layout.plate!;
    // Слева от надписей, за скруглением: верх плашки серый, низ почти чёрный.
    const plateX = p.box!.x0 + (plate.x + plate.w * 0.12) * u;
    const top = luminanceAt(r, plateX, p.box!.y0 + (plate.y + plate.h * 0.2) * u);
    const bottom = luminanceAt(r, plateX, p.box!.y0 + (plate.y + plate.h * 0.8) * u);
    assert.ok(bottom < 60 && top > bottom + 25, `градиент плашки: верх ${top.toFixed(0)}, низ ${bottom.toFixed(0)}`);
  }
});

test("штамп: надписи плашки и строка внизу каждой страницы (копирайт шаблона); проба ничего не рисует", () => {
  const texts: Array<{ text: string; x: number; y: number; page: number }> = [];
  const make = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const fontName = registerJournalUnicodeFont(doc);
    prepareJournalQr(doc, URL_SAMPLE);
    registerJournalQrSlot(doc, { x0: 260, y0: M, x1: 287, y1: 30 });
    doc.addPage("a4", "portrait");
    const original = doc.text.bind(doc);
    (doc as unknown as { text: (...args: unknown[]) => jsPDF }).text = (...args: unknown[]) => {
      const [text, x, y] = args as [string, number, number];
      const page = (doc as jsPDF & { getCurrentPageInfo: () => { pageNumber: number } }).getCurrentPageInfo().pageNumber;
      texts.push({ text: String(text), x, y, page });
      return (original as (...a: unknown[]) => jsPDF)(...args);
    };
    return { doc, fontName };
  };
  const footer = "© WeSetup — электронные журналы ХАССП и СанПиН · wesetup.ru";

  const { doc, fontName } = make();
  const placements = stampJournalQr(doc, { url: URL_SAMPLE, footer, fontName, tracker: null });
  assert.deepEqual(
    placements.map((p) => p.where),
    ["header", "corner"],
  );
  assert.ok(texts.some((t) => t.page === 1 && t.text === BRAND_QR_CAPTION_TITLE), "«Отсканировать» на плашке");
  assert.ok(texts.some((t) => t.page === 2 && t.text === BRAND_QR_CAPTION_SITE), "«wesetup.ru» на плашке");
  for (const [page, height] of [
    [1, 210],
    [2, 297],
  ] as const) {
    const line = texts.find((t) => t.page === page && t.text === footer);
    assert.ok(line, `строка внизу стр. ${page}`);
    assert.equal(line.x, M);
    assert.ok(Math.abs(line.y - (height - M)) < 0.01, `базовая линия на нижнем поле: ${line.y}`);
  }

  texts.length = 0;
  const probe = make();
  const probePlacements = stampJournalQr(probe.doc, { url: URL_SAMPLE, footer, fontName: probe.fontName, probeOnly: true });
  assert.deepEqual(
    probePlacements.map((p) => p.box),
    placements.map((p) => p.box),
    "проба ставит QR туда же",
  );
  assert.equal(texts.length, 0, "проба ничего не рисует");
});
