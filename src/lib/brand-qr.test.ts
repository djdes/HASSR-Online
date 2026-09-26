import assert from "node:assert/strict";
import test from "node:test";

import { loadImage, createCanvas } from "@napi-rs/canvas";
import QRCode from "qrcode";

import {
  BRAND_QR_CAPTION_SITE,
  BRAND_QR_CAPTION_TITLE,
  brandQrLayout,
  brandQrPadModules,
  brandQrPng,
  brandQrPngDataUrl,
  brandQrSvg,
  type BrandQrLayout,
} from "@/lib/brand-qr";
import { BRAND_QR_CAPTION_ASPECT, brandQrHeightFor } from "@/lib/brand-qr-shared";
import { journalQrMatrix } from "@/lib/pdf-journal-qr";

/**
 * Фирменный QR (brand-qr.ts): раскладка, SVG и PNG. Что код читается
 * телефоном, доказывают декодеры в `.agent/tasks/qr-brand-2026-09`
 * (jsQR, OpenCV, zxing-cpp на реальных размерах печати); здесь — что
 * нарисовано ровно то, что задумано.
 */

// Самый длинный адрес продукта: дополнительный QR документа гигиены (+ &view=all).
const LONG =
  "https://wesetup.ru/journal-fill/cmg1abcdefghijklmnopqrstu/hygiene?token=journal%3Acmg1abcdefghijklmnopqrstu%3Ahygiene%3Acmg2abcdefghijklmnopqrstu%3A2026-09-30.1758900000000.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ&view=all";
const SHORT = "https://wesetup.ru/q/AbCdEfGhIjKlMnOpQrStUvWxYz012345";

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

/** Тёмный ли модуль (row, col) на картинке: по пикселю в центре модуля. */
function moduleDarkOnImage(p: Pixels, layout: BrandQrLayout, row: number, col: number): boolean {
  const scale = p.width / layout.width;
  return luma(rgbAt(p, (layout.quiet + col + 0.5) * scale, (layout.quiet + row + 0.5) * scale)) < 128;
}

function inBox(box: { x: number; y: number; w: number; h: number }, row: number, col: number, quiet: number) {
  const x = quiet + col + 0.5;
  const y = quiet + row + 0.5;
  return x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h;
}

test("full: коррекция H, подложка по центру ≤ 20 % матрицы, квадратные «глаза», плашка", () => {
  for (const url of [LONG, SHORT]) {
    const layout = brandQrLayout(url);
    assert.equal(layout.errorCorrection, "H");
    assert.equal(layout.size, QRCode.create(url, { errorCorrectionLevel: "H" }).modules.size);
    const pad = layout.pad!;
    assert.ok(pad && pad.w % 2 === 1 && pad.w / layout.size <= 0.2, `подложка ${pad.w} из ${layout.size}`);
    assert.equal(pad.x - layout.quiet, (layout.size - pad.w) / 2, "ровно по центру");
    // «Глаза» — обычные квадратные модули (скруглённые OpenCV не находит).
    for (const [r0, c0] of [[0, 0], [0, layout.size - 7], [layout.size - 7, 0]]) {
      for (let i = 0; i < 7; i += 1) {
        for (let j = 0; j < 7; j += 1) assert.equal(layout.plain(r0 + i, c0 + j), layout.dark(r0 + i, c0 + j));
      }
    }
    assert.ok(Math.abs(layout.height / layout.width - BRAND_QR_CAPTION_ASPECT) < 1e-9);
    assert.equal(layout.title?.text, BRAND_QR_CAPTION_TITLE);
    assert.equal(layout.site?.text, BRAND_QR_CAPTION_SITE);
    assert.ok(layout.plate && layout.plate.y > layout.quiet + layout.size + 2, "между матрицей и плашкой ≥ 2 модулей");
    // Модули под подложкой не рисуются (центр в «кресте» скруглённого
    // квадрата — точно под ней).
    const underPadCross = (row: number, col: number) => {
      const x = layout.quiet + col + 0.5;
      const y = layout.quiet + row + 0.5;
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
  // Подложка: нечётная сторона не больше 20 % (для любого размера матрицы).
  for (let size = 21; size <= 177; size += 4) {
    const k = brandQrPadModules(size);
    assert.ok(k % 2 === 1 && k <= size * 0.2 + 1e-9 && k >= size * 0.2 - 2, `${size} → ${k}`);
  }
});

test("compact: коррекция M, без логотипа и плашки — матрица как у прежнего углового QR", () => {
  const layout = brandQrLayout(SHORT, { variant: "compact" });
  assert.equal(layout.errorCorrection, "M");
  assert.equal(layout.pad, null);
  assert.equal(layout.plate, null);
  assert.equal(layout.width, layout.height);
  const reference = QRCode.create(SHORT, { errorCorrectionLevel: "M" });
  assert.equal(layout.size, reference.modules.size);
  for (let row = 0; row < layout.size; row += 1) {
    for (let col = 0; col < layout.size; col += 1) {
      assert.equal(layout.plain(row, col), Boolean(reference.modules.get(row, col)));
    }
  }
  assert.equal(journalQrMatrix(SHORT).modules.size, reference.modules.size, "угловой QR журнала — тот же компактный");
});

test("SVG: логотип, надписи, только чёрные модули, без id и url(#…) (печать не теряет плашку)", async () => {
  const svg = await brandQrSvg(LONG);
  const layout = brandQrLayout(LONG);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="'));
  assert.ok(svg.includes(`viewBox="0 0 ${layout.width} ${Math.round(layout.height * 1000) / 1000}"`));
  assert.match(svg, /<image [^>]*href="data:image\/jpeg;base64,[A-Za-z0-9+/=]{2000,}"/);
  assert.ok(svg.includes(`>${BRAND_QR_CAPTION_TITLE}</text>`));
  assert.ok(svg.includes(`>${BRAND_QR_CAPTION_SITE}</text>`));
  assert.ok(svg.includes('stroke="#000000"'), "модули и «глаза» — чёрные");
  assert.ok(!/\sid="/.test(svg) && !svg.includes("url(#"), "без id-ссылок");
  // Цвет только у логотипа и серой плашки: модули и «глаза» — чистый чёрный.
  const fills = new Set(Array.from(svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g), (m) => m[1]));
  for (const color of fills) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 0x30, `${color} — не цветной`);
  }
  const bare = await brandQrSvg(SHORT, { caption: false });
  assert.ok(!bare.includes("<text"), "без плашки — без надписей");
  const compact = await brandQrSvg(SHORT, { variant: "compact" });
  assert.ok(!compact.includes("<image") && !compact.includes("<text"));
});

test("PNG full: модули на своих местах, под подложкой нет модулей, «глаза» чёрные, градиент плашки", async () => {
  const layout = brandQrLayout(LONG);
  const p = await pixels(await brandQrPng(LONG, { width: 600 }));
  const scale = p.width / layout.width;
  assert.ok(Number.isInteger(scale) && p.width >= 600);
  assert.equal(p.height, Math.round(layout.height * scale));
  let mismatches = 0;
  for (let row = 0; row < layout.size; row += 1) {
    for (let col = 0; col < layout.size; col += 1) {
      const onImage = moduleDarkOnImage(p, layout, row, col);
      if (inBox(layout.pad!, row, col, layout.quiet)) continue; // знак сайта — отдельная проверка ниже
      if (onImage !== layout.dark(row, col)) mismatches += 1;
    }
  }
  assert.equal(mismatches, 0, "вне подложки картинка совпадает с матрицей, «глаза» — тоже");
  // Центры «глаз» (зрачки) — чистый чёрный (ч/б принтер печатает сплошным тонером).
  for (const [r0, c0] of [[0, 0], [0, layout.size - 7], [layout.size - 7, 0]]) {
    const [r, g, b] = rgbAt(p, (layout.quiet + c0 + 3.5) * scale, (layout.quiet + r0 + 3.5) * scale);
    assert.ok(r === 0 && g === 0 && b === 0);
  }
  // Плашка: сверху светлее, чем снизу (серый → чёрный), по краям — белое поле листа.
  const plate = layout.plate!;
  const cx = (plate.x + plate.w * 0.08) * scale;
  const top = luma(rgbAt(p, cx, (plate.y + plate.h * 0.06) * scale));
  const bottom = luma(rgbAt(p, cx, (plate.y + plate.h * 0.94) * scale));
  assert.ok(top > bottom + 40, `градиент ${top} → ${bottom}`);
  // Белые буквы на плашке есть.
  let white = 0;
  for (let x = Math.floor(plate.x * scale); x < (plate.x + plate.w) * scale; x += 1) {
    if (luma(rgbAt(p, x, layout.title!.y * scale - layout.title!.size * 0.3 * scale)) > 200) white += 1;
  }
  assert.ok(white > 20, "надпись «Отсканировать» белая");
});

test("PNG compact: ровно матрица с тихой зоной в 1 модуль, только чёрное и белое", async () => {
  const layout = brandQrLayout(SHORT, { variant: "compact" });
  const p = await pixels(await brandQrPng(SHORT, { variant: "compact", width: 300 }));
  assert.equal(p.width, p.height);
  assert.equal(p.width % layout.width, 0);
  for (let row = 0; row < layout.size; row += 1) {
    for (let col = 0; col < layout.size; col += 1) {
      assert.equal(moduleDarkOnImage(p, layout, row, col), layout.dark(row, col));
    }
  }
  for (let i = 0; i < p.data.length; i += 4) {
    assert.ok((p.data[i] === 0 || p.data[i] === 255) && p.data[i] === p.data[i + 1] && p.data[i] === p.data[i + 2]);
  }
});

test("data URL и пропорции для клиента", async () => {
  const url = await brandQrPngDataUrl(SHORT, { width: 320 });
  assert.match(url, /^data:image\/png;base64,/);
  const p = await pixels(Buffer.from(url.split(",")[1], "base64"));
  assert.ok(Math.abs(p.height / p.width - BRAND_QR_CAPTION_ASPECT) < 0.02);
  assert.equal(brandQrHeightFor(220), Math.ceil(220 * BRAND_QR_CAPTION_ASPECT));
});
