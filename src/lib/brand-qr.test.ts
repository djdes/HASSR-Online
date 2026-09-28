import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { loadImage, createCanvas } from "@napi-rs/canvas";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";

import {
  BRAND_QR_CAPTION_TITLE,
  BRAND_QR_QUIET,
  brandQrCellHeight,
  brandQrLayout,
  brandQrPadModules,
  brandQrPng,
  brandQrPngDataUrl,
  brandQrSvg,
  drawBrandQrCellPdf,
  drawBrandQrTilePdf,
} from "@/lib/brand-qr";
import { BRAND_QR_CAPTION_ASPECT, BRAND_QR_FRAME, BRAND_QR_STRIP, brandQrHeightFor } from "@/lib/brand-qr-shared";
import { registerJournalUnicodeFont } from "@/lib/pdf-journal-font";
import { journalQrMatrix } from "@/lib/pdf-journal-qr";

/**
 * Фирменный ч/б QR (brand-qr.ts): раскладка, SVG, PNG и jsPDF. Что код
 * читается телефоном, доказывают декодеры в `.agent/tasks/qr-bw-minimal-2026-09`
 * (jsQR и zxing-cpp на реальных размерах печати); здесь — что нарисовано
 * ровно то, что задумано: только чёрный и белый, рамка, окно, полоса с одним
 * словом, знак по центру.
 */

// Самый длинный адрес продукта: дополнительный QR документа гигиены (+ &view=all).
const LONG =
  "https://wesetup.ru/journal-fill/cmg1abcdefghijklmnopqrstu/hygiene?token=journal%3Acmg1abcdefghijklmnopqrstu%3Ahygiene%3Acmg2abcdefghijklmnopqrstu%3A2026-09-30.1758900000000.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ&view=all";
const SHORT = "https://wesetup.ru/q/AbCdEfGhIjKlMnOpQrStUvWxYz012345";
/** Ширина слова в em у DejaVu Sans Bold (как в brand-qr.ts). */
const TITLE_EM = 8.69;

type Pixels = { width: number; height: number; data: Uint8ClampedArray };

async function pixels(png: Buffer): Promise<Pixels> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  return { width: image.width, height: image.height, data };
}

function rgbAt(p: Pixels, x: number, y: number): [number, number, number] {
  const i = (Math.floor(y) * p.width + Math.floor(x)) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2]];
}

const luma = ([r, g, b]: [number, number, number]) => 0.299 * r + 0.587 * g + 0.114 * b;

function inBox(box: { x: number; y: number; w: number; h: number }, x: number, y: number) {
  return x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h;
}

/** Строки потока содержимого страницы jsPDF (операторы PDF). */
function pageOps(doc: jsPDF, page = 1): string[] {
  return (doc.internal as unknown as { pages: Array<string[] | undefined> }).pages[page] ?? [];
}

/** Операторы цвета в куске потока: цветные (rg/RG/k/K/sc/scn/cs) и значения серых `g`/`G`. */
function colorOperators(ops: string[]): { gray: string[]; color: string[] } {
  const stream = ops.join("\n");
  const color = stream.match(/(?:^|\s)[\d.\s]+\s(?:rg|RG|k|K|sc|SC|scn|SCN|cs|CS)(?=\s|$)/g) ?? [];
  const gray = Array.from(stream.matchAll(/(?:^|\s)([\d.]+)\s[gG](?=\s|$)/g), (m) => String(Number(m[1])));
  return { gray: [...new Set(gray)].sort(), color };
}

test("раскладка: H, окно кода с тихой зоной 2 модуля, тонкая рамка, полоса со словом, знак по центру ≤ 20 %", () => {
  for (const url of [LONG, SHORT]) {
    const layout = brandQrLayout(url);
    assert.equal(layout.errorCorrection, "H");
    assert.equal(layout.size, QRCode.create(url, { errorCorrectionLevel: "H" }).modules.size);
    assert.equal(layout.quiet, BRAND_QR_QUIET);
    // Окно — квадрат матрицы с тихой зоной; рамка слева, сверху и справа — доля ширины.
    const w = layout.window;
    assert.equal(w.w, layout.size + 2 * BRAND_QR_QUIET);
    assert.equal(w.h, w.w);
    assert.ok(Math.abs(layout.frame - layout.width * BRAND_QR_FRAME) < 1e-9);
    assert.ok(Math.abs(w.x - layout.frame) < 1e-9 && Math.abs(w.y - layout.frame) < 1e-9);
    assert.ok(Math.abs(layout.width - (w.w + 2 * layout.frame)) < 1e-9);
    assert.ok(layout.frame > 0.2 && layout.frame < 1, `рамка тонкая: ${layout.frame} модуля`);
    assert.ok(Math.abs(layout.height / layout.width - BRAND_QR_CAPTION_ASPECT) < 1e-9);
    // Один чёрный блок со скруглением; окно скруглено внутри рамки.
    const block = layout.block!;
    assert.deepEqual([block.x, block.y, block.w, block.h], [0, 0, layout.width, layout.height]);
    assert.ok(block.r > 0 && block.r < layout.width * 0.1, "скругление умеренное");
    assert.ok(Math.abs(w.r - (block.r - layout.frame)) < 1e-9);
    // Полоса — сразу под окном (без зазора), до низа блока.
    const strip = layout.strip!;
    assert.ok(Math.abs(strip.y - (w.y + w.h)) < 1e-9);
    assert.ok(Math.abs(strip.h - layout.width * BRAND_QR_STRIP) < 1e-9);
    assert.ok(Math.abs(strip.y + strip.h - layout.height) < 1e-9);
    // Одно слово, по центру, крупно по ширине, целиком в полосе.
    const t = layout.title!;
    assert.equal(t.text, BRAND_QR_CAPTION_TITLE);
    assert.ok(Math.abs(t.x - layout.width / 2) < 1e-9);
    const textWidth = TITLE_EM * t.size;
    assert.ok(textWidth <= layout.width * 0.9 && textWidth >= layout.width * 0.85, `слово ${textWidth} из ${layout.width}`);
    assert.ok(t.y - 0.75 * t.size > strip.y && t.y + 0.21 * t.size < strip.y + strip.h, "слово в полосе");
    assert.ok(!("site" in layout), "адреса сайта в плитке нет");

    // Подложка знака: нечётная, ≤ 20 % матрицы, ровно по центру; «глаза» — квадратные.
    const pad = layout.pad;
    assert.ok(pad.w % 2 === 1 && pad.w / layout.size <= 0.2, `подложка ${pad.w} из ${layout.size}`);
    assert.equal(pad.x - w.x - layout.quiet, (layout.size - pad.w) / 2, "ровно по центру");
    assert.ok(inBox(pad, layout.mark.x + layout.mark.w / 2, layout.mark.y + layout.mark.h / 2) && layout.mark.w < pad.w);
    for (const [r0, c0] of [[0, 0], [0, layout.size - 7], [layout.size - 7, 0]]) {
      for (let i = 0; i < 7; i += 1) {
        for (let j = 0; j < 7; j += 1) assert.equal(layout.plain(r0 + i, c0 + j), layout.dark(r0 + i, c0 + j));
      }
    }
    // Модули под подложкой не рисуются (центр в «кресте» скруглённого квадрата — точно под ней).
    const underPadCross = (row: number, col: number) => {
      const x = w.x + layout.quiet + col + 0.5;
      const y = w.y + layout.quiet + row + 0.5;
      const inX = (a: number, b: number) => x > a && x < b;
      const inY = (a: number, b: number) => y > a && y < b;
      return (
        (inX(pad.x + pad.r, pad.x + pad.w - pad.r) && inY(pad.y, pad.y + pad.h)) ||
        (inY(pad.y + pad.r, pad.y + pad.h - pad.r) && inX(pad.x, pad.x + pad.w))
      );
    };
    let cleared = 0;
    for (let row = 0; row < layout.size; row += 1) {
      for (let col = 0; col < layout.size; col += 1) {
        if (layout.plain(row, col)) {
          assert.ok(layout.dark(row, col));
          assert.ok(!underPadCross(row, col), `модуль ${row},${col} под подложкой`);
        } else if (layout.dark(row, col) && underPadCross(row, col)) cleared += 1;
      }
    }
    assert.ok(cleared > 0);
  }
  for (let size = 21; size <= 177; size += 4) {
    const k = brandQrPadModules(size);
    assert.ok(k % 2 === 1 && k <= size * 0.2 + 1e-9 && k >= size * 0.2 - 2, `${size} → ${k}`);
  }
  // QR печатного журнала — та же матрица H.
  assert.equal(journalQrMatrix(SHORT).modules.size, brandQrLayout(SHORT).size);
});

test("без полосы (наклейка лендинга): только окно с кодом и знаком — без рамки и слова", () => {
  const layout = brandQrLayout(SHORT, { caption: false });
  assert.equal(layout.frame, 0);
  assert.equal(layout.width, layout.size + 2 * BRAND_QR_QUIET);
  assert.equal(layout.height, layout.width);
  assert.deepEqual([layout.window.x, layout.window.y, layout.window.r], [0, 0, 0]);
  assert.equal(layout.block, null);
  assert.equal(layout.strip, null);
  assert.equal(layout.title, null);
  assert.ok(layout.pad.w >= 3, "знак есть");
});

function spyPdf(doc: jsPDF) {
  const calls = { image: 0, rounded: 0, circle: 0, texts: [] as string[], rects: [] as number[][] };
  const target = doc as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ["rect", "roundedRect", "circle", "addImage", "text"] as const) {
    const original = target[name].bind(doc);
    target[name] = (...args: unknown[]) => {
      if (name === "rect") calls.rects.push((args as number[]).slice(0, 4));
      if (name === "roundedRect") calls.rounded += 1;
      if (name === "circle") calls.circle += 1;
      if (name === "addImage") calls.image += 1;
      if (name === "text") calls.texts.push(String(args[0]));
      return original(...args);
    };
  }
  return calls;
}

test("jsPDF: плитка с рамкой — вектор, только серые операторы цвета, знак фигурами, одно слово", () => {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const fontName = registerJournalUnicodeFont(doc);
  doc.setFont(fontName, "normal");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.setFillColor(238, 241, 255); // заливка бланка до плитки — цветная
  const before = pageOps(doc).length;
  const calls = spyPdf(doc);
  const layout = brandQrLayout(SHORT);
  const box = drawBrandQrTilePdf(doc, layout, 100, 50, 20, { fontName });
  assert.equal(box.width, 20);
  assert.ok(Math.abs(box.height / box.width - BRAND_QR_CAPTION_ASPECT) < 1e-9);
  assert.ok(Math.abs(box.module - 20 / layout.width) < 1e-12);
  // Окно кода — внутри рамки.
  assert.ok(Math.abs(box.window.x0 - (100 + layout.frame * box.module)) < 1e-9);
  assert.ok(Math.abs(box.window.x1 - box.window.x0 - layout.window.w * box.module) < 1e-9);
  assert.equal(calls.image, 0, "никаких картинок — знак векторный");
  assert.ok(calls.rounded >= 3 && calls.circle >= 2, "блок, окно, подложка и фигуры знака");
  assert.ok(calls.rects.length > layout.size, "модули — прямоугольниками по строкам");
  assert.deepEqual(calls.texts, [BRAND_QR_CAPTION_TITLE], "одно слово, без адреса сайта");
  // Операторы плитки — внутри `q … Q`, цвета — только серые 0 и 1 (чёрный, белый):
  // заливку бланка после плитки возвращает Q, без повторного оператора цвета.
  const tile = pageOps(doc).slice(before);
  assert.equal(tile[0], "q");
  assert.equal(tile[tile.length - 1], "Q");
  const ops = colorOperators(tile);
  assert.deepEqual(ops.color, [], `цветные операторы: ${ops.color.join(", ")}`);
  assert.deepEqual(ops.gray, ["0", "1"]);
  // Шрифт, кегль и цвет текста документа — как были.
  assert.equal(doc.getFontSize(), 10);
  assert.deepEqual(doc.getFont().fontStyle, "normal");
  assert.equal(doc.getTextColor(), "#000000");
  assert.throws(() => drawBrandQrTilePdf(doc, brandQrLayout(SHORT, { caption: false }), 0, 0, 20, { fontName }));
});

test("jsPDF: плитка в ячейке шапки — окно на всю ширину ячейки, код по центру окна, полоса снизу во всю ширину", () => {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const fontName = registerJournalUnicodeFont(doc);
  const calls = spyPdf(doc);
  const layout = brandQrLayout(LONG.slice(0, 90));
  const u = 0.365;
  const width = layout.window.w * u;
  const needed = brandQrCellHeight(layout) * u;
  const cell = { x0: 250, y0: 10, x1: 250 + width, y1: 10 + needed + 3 }; // строки шапки выше плитки
  const box = drawBrandQrCellPdf(doc, layout, cell, { fontName });
  assert.ok(Math.abs(box.module - u) < 1e-12);
  const strip = (layout.strip!.h) * u;
  // Окно — ровно по ширине ячейки, по высоте — по центру над полосой.
  assert.ok(Math.abs(box.window.x0 - cell.x0) < 1e-9 && Math.abs(box.window.x1 - cell.x1) < 1e-9);
  const above = box.window.y0 - cell.y0;
  const below = cell.y1 - strip - box.window.y1;
  assert.ok(Math.abs(above - below) < 1e-9 && above > 1, `код по центру окна: ${above} / ${below}`);
  // Полоса — чёрный прямоугольник во всю ширину ячейки у её низа.
  assert.ok(
    calls.rects.some(([x, y, w, h]) => Math.abs(x - cell.x0) < 1e-9 && Math.abs(w - width) < 1e-9 && Math.abs(y + h - cell.y1) < 1e-9 && Math.abs(h - strip) < 1e-9),
    "полоса у низа ячейки",
  );
  assert.deepEqual(calls.texts, [BRAND_QR_CAPTION_TITLE]);
  assert.equal(calls.image, 0);
  const ops = colorOperators(pageOps(doc));
  assert.deepEqual(ops.color, [], "только серые операторы");
  assert.ok(ops.gray.every((v) => v === "0" || v === "1"), `серые: ${ops.gray.join(", ")}`);
});

test("jsPDF: слово — всегда свой DejaVu Sans Bold: и у бланка без настоящего жирного, и у журнала с засечками", () => {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  // Как бумажный бланк: «bold» — тот же файл, что обычный.
  const fontName = "PaperLike";
  doc.addFileToVFS("paper-like.ttf", fs.readFileSync("src/lib/pdf-fonts/DejaVuSans.ttf").toString("base64"));
  doc.addFont("paper-like.ttf", fontName, "normal");
  doc.addFont("paper-like.ttf", fontName, "bold");
  const fonts: string[] = [];
  const target = doc as unknown as Record<string, (...args: unknown[]) => unknown>;
  const original = target.text.bind(doc);
  target.text = (...args: unknown[]) => {
    fonts.push(doc.getFont().postScriptName);
    return original(...args);
  };
  drawBrandQrTilePdf(doc, brandQrLayout(SHORT), 10, 10, 20, { fontName });
  assert.deepEqual(fonts, ["wesetup-qr-bold.ttf"]);
  // У печатного журнала свой жирный настоящий (Liberation Serif Bold), но
  // слово в полосе — тем же DejaVu Sans Bold, что в PNG: плитка одинакова во
  // всех выходах, кегль подобран по его ширине.
  const journal = new jsPDF();
  const journalFont = registerJournalUnicodeFont(journal);
  const used: string[] = [];
  const jt = journal as unknown as Record<string, (...args: unknown[]) => unknown>;
  const jo = jt.text.bind(journal);
  jt.text = (...args: unknown[]) => {
    used.push(journal.getFont().fontName);
    return jo(...args);
  };
  const layout = brandQrLayout(SHORT);
  drawBrandQrTilePdf(journal, layout, 10, 10, 20, { fontName: journalFont });
  const cellHeight = (brandQrCellHeight(layout) * 20) / layout.window.w;
  drawBrandQrCellPdf(journal, layout, { x0: 50, y0: 10, x1: 70, y1: 10 + cellHeight }, { fontName: journalFont });
  assert.deepEqual(used, ["WeSetupQrBold", "WeSetupQrBold"]);
});

test("SVG: знак фигурами, только чёрный и белый, одно слово, без id и url(#…)", async () => {
  const svg = await brandQrSvg(LONG);
  const layout = brandQrLayout(LONG);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="'));
  assert.ok(svg.includes(`viewBox="0 0 ${Math.round(layout.width * 1000) / 1000} ${Math.round(layout.height * 1000) / 1000}"`));
  assert.ok(!svg.includes("<image"), "знак — не картинка");
  assert.ok(svg.includes("<circle"), "«C» знака — кругами");
  assert.equal((svg.match(/<text/g) ?? []).length, 1);
  assert.ok(svg.includes(`>${BRAND_QR_CAPTION_TITLE}</text>`));
  assert.ok(!svg.includes("wesetup.ru"), "адреса сайта нет");
  assert.ok(!/\sid="/.test(svg) && !svg.includes("url(#"), "без id-ссылок");
  const colors = new Set(Array.from(svg.matchAll(/(?:fill|stroke)="([^"]+)"/g), (m) => m[1]));
  colors.delete("none");
  assert.deepEqual([...colors].sort(), ["#000000", "#ffffff"], `цвета: ${[...colors].join(", ")}`);
  const bare = await brandQrSvg(SHORT, { caption: false });
  assert.ok(!bare.includes("<text"), "без полосы — без слова");
  assert.ok(bare.includes("<circle"), "знак есть и без полосы");
});

test("PNG: модули на местах, под подложкой пусто, рамка и полоса чёрные, слово белое, только оттенки серого", async () => {
  const layout = brandQrLayout(LONG);
  const png = await brandQrPng(LONG, { width: 600 });
  const p = await pixels(png);
  const scale = Math.ceil(600 / layout.width);
  const frame = (p.width - layout.window.w * scale) / 2;
  assert.ok(Number.isInteger(frame) && frame >= 1, `рамка ${frame} px`);
  assert.ok(Math.abs(frame - layout.frame * scale) <= 0.5);
  assert.ok(Math.abs(p.height / p.width - BRAND_QR_CAPTION_ASPECT) < 0.01);
  const center = (v: number) => frame + (layout.quiet + v + 0.5) * scale;
  let mismatches = 0;
  for (let row = 0; row < layout.size; row += 1) {
    for (let col = 0; col < layout.size; col += 1) {
      const x = layout.window.x + layout.quiet + col + 0.5;
      const y = layout.window.y + layout.quiet + row + 0.5;
      if (inBox(layout.pad, x, y)) continue; // знак — отдельная проверка ниже
      if (luma(rgbAt(p, center(col), center(row))) < 128 !== layout.dark(row, col)) mismatches += 1;
    }
  }
  assert.equal(mismatches, 0, "вне подложки картинка совпадает с матрицей, «глаза» — тоже");
  for (const [r0, c0] of [[0, 0], [0, layout.size - 7], [layout.size - 7, 0]]) {
    assert.deepEqual(rgbAt(p, center(c0 + 3), center(r0 + 3)), [0, 0, 0], "зрачок «глаза» — чистый чёрный");
  }
  // Рамка: середина левого края — чёрная; тихая зона рядом — белая.
  assert.deepEqual(rgbAt(p, frame / 2, p.height * 0.4), [0, 0, 0]);
  assert.deepEqual(rgbAt(p, frame + scale, p.height * 0.4), [255, 255, 255]);
  // Полоса: сплошной чёрный у левого края под окном (до слова), белые буквы в середине.
  const stripTop = frame + layout.window.w * scale;
  assert.deepEqual(rgbAt(p, frame + 2, stripTop + (p.height - stripTop) / 2), [0, 0, 0]);
  let white = 0;
  const textY = stripTop + (layout.title!.y - layout.strip!.y) * scale - layout.title!.size * 0.3 * scale;
  for (let x = 0; x < p.width; x += 1) if (luma(rgbAt(p, x, textY)) > 200) white += 1;
  assert.ok(white > 40, "надпись «Отсканировать» белая");
  // Знак: в середине подложки есть и чёрное (обложка), и белое («C»).
  const markDark = luma(rgbAt(p, frame + (layout.mark.x - layout.window.x + layout.mark.w * 0.85) * scale, frame + (layout.mark.y - layout.window.y + layout.mark.h * 0.2) * scale));
  assert.ok(markDark < 60, "обложка знака — чёрная");
  // Только оттенки серого (сглаживание краёв допустимо), почти всё — 0 или 255.
  let extremes = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    assert.ok(p.data[i] === p.data[i + 1] && p.data[i] === p.data[i + 2], "пиксель не серый");
    if (p.data[i] === 0 || p.data[i] === 255) extremes += 1;
  }
  assert.ok(extremes / (p.data.length / 4) > 0.97, `0/255: ${extremes}`);
});

test("data URL и пропорции для клиента", async () => {
  const url = await brandQrPngDataUrl(SHORT, { width: 320 });
  assert.match(url, /^data:image\/png;base64,/);
  const p = await pixels(Buffer.from(url.split(",")[1], "base64"));
  assert.ok(Math.abs(p.height / p.width - BRAND_QR_CAPTION_ASPECT) < 0.02);
  assert.equal(brandQrHeightFor(220), Math.ceil(220 * BRAND_QR_CAPTION_ASPECT));
  assert.ok(Math.abs(BRAND_QR_CAPTION_ASPECT - (1 - BRAND_QR_FRAME + BRAND_QR_STRIP)) < 1e-12);
});
