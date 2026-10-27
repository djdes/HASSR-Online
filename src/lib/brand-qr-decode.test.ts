import assert from "node:assert/strict";
import test from "node:test";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import jsQR from "jsqr";

import { brandQrLayout, brandQrPadModules, brandQrPng, brandQrSvg, type BrandQrCenter, type BrandQrOptions } from "@/lib/brand-qr";
import { resolvePrintBrand, qrFrameColor, DEFAULT_PRINT_BRAND_SOURCE } from "@/lib/print-brand";

/**
 * AC5 (2026-10-27): код с цветной рамкой и любым центром читается декодером
 * при каждом размере печати. Модули при этом — всегда чёрные на белом.
 */

const URL_TO_ENCODE = "https://wesetup.ru/equipment-fill/abc123?token=eyJhbGciOiJIUzI1NiJ9.QR-TEST";

function colorSquarePng(): Uint8Array {
  const canvas = createCanvas(300, 300);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e8590c";
  ctx.fillRect(0, 0, 300, 300);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 200px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Д", 150, 160);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

const lightYellow = resolvePrintBrand({ ...DEFAULT_PRINT_BRAND_SOURCE, brandColor: "#ffe14d" });

const FRAMES: Array<[string, string]> = [
  ["black", "#000000"],
  ["indigo", "#5566f6"],
  ["light yellow darkened", qrFrameColor(lightYellow)],
];

const CENTERS: Array<[string, BrandQrCenter]> = [
  ["mark", { kind: "mark" }],
  ["image", { kind: "image", png: colorSquarePng() }],
  ["letter", { kind: "letter", letter: "Д", color: "#5566f6" }],
];

async function decode(png: Buffer): Promise<string | null> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height);
  return jsQR(data.data, data.width, data.height)?.data ?? null;
}

for (const [frameName, frameColor] of FRAMES) {
  for (const [centerName, center] of CENTERS) {
    for (const width of [300, 600, 1200]) {
      test(`QR decodes: frame ${frameName}, center ${centerName}, ${width}px`, async () => {
        const options: BrandQrOptions = { frameColor, center };
        const png = await brandQrPng(URL_TO_ENCODE, { ...options, width });
        assert.equal(await decode(png), URL_TO_ENCODE);
      });
    }
  }
}

test("QR modules stay black whatever the frame colour is", async () => {
  const width = 600;
  const png = await brandQrPng(URL_TO_ENCODE, {
    frameColor: "#5566f6",
    center: { kind: "letter", letter: "Д", color: "#e8590c" },
    width,
  });
  const layout = brandQrLayout(URL_TO_ENCODE);
  const scale = Math.max(1, Math.ceil(width / layout.width));
  const frame = Math.max(1, Math.round(layout.frame * scale));
  const side = layout.window.w * scale;
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const top = ctx.getImageData(Math.floor(image.width / 2), 0, 1, 1).data;
  assert.deepEqual([top[0], top[1], top[2]], [0x55, 0x66, 0xf6], "frame carries the brand colour");
  // Внутри окна, кроме подложки центра, — только чёрный и белый.
  const pad = brandQrPadModules(layout.size) * scale;
  const from = Math.round((side - pad) / 2) - 1;
  const data = ctx.getImageData(frame, frame, side, side).data;
  let odd = 0;
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      if (x > from && x < from + pad + 2 && y > from && y < from + pad + 2) continue;
      const i = (y * side + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const black = r < 40 && g < 40 && b < 40;
      const white = r > 215 && g > 215 && b > 215;
      if (!black && !white) odd += 1;
    }
  }
  // Допустимы лишь сглаженные углы скруглённого окна у рамки.
  assert.ok(odd < scale * 40, `coloured pixels in the code window: ${odd}`);
});

test("SVG: frame colour only on the block, modules stay #000; default stays black and white", async () => {
  const coloured = await brandQrSvg(URL_TO_ENCODE, { frameColor: "#5566f6" });
  assert.match(coloured, /fill="#5566f6"/);
  assert.match(coloured, /stroke="#000000"/);
  const plain = await brandQrSvg(URL_TO_ENCODE);
  assert.doesNotMatch(plain, /#5566f6/);
  const withImage = await brandQrSvg(URL_TO_ENCODE, { center: { kind: "image", png: colorSquarePng() } });
  assert.match(withImage, /<image [^>]*href="data:image\/png;base64,/);
  const withLetter = await brandQrSvg(URL_TO_ENCODE, { center: { kind: "letter", letter: "Д", color: "#5566f6" } });
  assert.match(withLetter, />Д<\/text>/);
});

test("a broken image centre falls back to the WeSetup mark", async () => {
  const svg = await brandQrSvg(URL_TO_ENCODE, { center: { kind: "image", png: new Uint8Array([1, 2, 3]) } });
  assert.doesNotMatch(svg, /<image /);
});
