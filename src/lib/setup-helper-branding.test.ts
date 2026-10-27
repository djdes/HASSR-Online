import assert from "node:assert/strict";
import test from "node:test";

import {
  LABEL_LOGO_HEIGHT_DOTS,
  LABEL_LOGO_MAX_WIDTH_DOTS,
  brandingVersion,
  ditherFloydSteinberg,
  labelLogoSize,
  rasterizeLabelLogo,
} from "./setup-helper-branding";

function rgba(width: number, height: number, fn: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(fn(x, y), (y * width + x) * 4);
  }
  return data;
}

test("дизеринг: результат строго чёрно-белый и не меняет вход", () => {
  const input = rgba(16, 16, (x) => [x * 16, x * 16, x * 16, 255]);
  const copy = input.slice();
  const out = ditherFloydSteinberg(input, 16, 16);
  assert.deepEqual(input, copy);
  for (let i = 0; i < out.length; i += 4) {
    assert.ok(out[i] === 0 || out[i] === 255);
    assert.equal(out[i], out[i + 1]);
    assert.equal(out[i], out[i + 2]);
    assert.equal(out[i + 3], 255);
  }
});

test("дизеринг: чистый чёрный и белый не меняются, прозрачность — белый", () => {
  const black = ditherFloydSteinberg(rgba(4, 4, () => [0, 0, 0, 255]), 4, 4);
  assert.ok(black.every((v, i) => (i % 4 === 3 ? v === 255 : v === 0)));
  const white = ditherFloydSteinberg(rgba(4, 4, () => [255, 255, 255, 255]), 4, 4);
  assert.ok(white.every((v) => v === 255));
  const clear = ditherFloydSteinberg(rgba(4, 4, () => [0, 0, 0, 0]), 4, 4);
  assert.ok(clear.every((v) => v === 255));
});

test("дизеринг: серый 50% даёт около половины чёрных точек", () => {
  const out = ditherFloydSteinberg(rgba(32, 32, () => [128, 128, 128, 255]), 32, 32);
  let black = 0;
  for (let i = 0; i < out.length; i += 4) if (out[i] === 0) black += 1;
  const share = black / (32 * 32);
  assert.ok(share > 0.4 && share < 0.6, `доля чёрного ${share}`);
});

test("размер логотипа: высота 40 точек, ширина по пропорциям, не шире 240", () => {
  assert.deepEqual(labelLogoSize(200, 100), { width: 80, height: LABEL_LOGO_HEIGHT_DOTS });
  const wide = labelLogoSize(1000, 100);
  assert.equal(wide.width, LABEL_LOGO_MAX_WIDTH_DOTS);
  assert.equal(wide.height, 24);
  assert.deepEqual(labelLogoSize(0, 10), { width: 0, height: 0 });
});

test("версия оформления: стабильна и зависит от логотипа, сайта и названия", () => {
  const base = { logoVersion: 3, site: "wesetup.ru", orgName: "Кафе" };
  assert.equal(brandingVersion(base), brandingVersion({ ...base }));
  assert.match(brandingVersion(base), /^[0-9a-f]{16}$/);
  assert.notEqual(brandingVersion(base), brandingVersion({ ...base, logoVersion: 4 }));
  assert.notEqual(brandingVersion(base), brandingVersion({ ...base, site: "cafe.ru" }));
  assert.notEqual(brandingVersion(base), brandingVersion({ ...base, orgName: "Кафе 2" }));
  assert.equal(brandingVersion({ ...base, logoVersion: null }), brandingVersion({ ...base, logoVersion: 0 }));
});

test("растеризация: PNG и SVG логотипа -> 1-битный PNG высотой 40 точек", async () => {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const canvas = createCanvas(300, 150);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 300, 0);
  gradient.addColorStop(0, "#000000");
  gradient.addColorStop(1, "#ffffff");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 300, 150);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><rect width="200" height="50" fill="#333"/></svg>';

  for (const file of [
    { bytes: new Uint8Array(canvas.toBuffer("image/png")), mime: "image/png" },
    { bytes: new TextEncoder().encode(svg), mime: "image/svg+xml" },
  ]) {
    const logo = await rasterizeLabelLogo(file);
    assert.ok(logo, file.mime);
    assert.equal(logo.heightDots, LABEL_LOGO_HEIGHT_DOTS);
    assert.ok(logo.widthDots > 0 && logo.widthDots <= LABEL_LOGO_MAX_WIDTH_DOTS);
    const image = await loadImage(Buffer.from(logo.png, "base64"));
    assert.equal(image.width, logo.widthDots);
    assert.equal(image.height, logo.heightDots);
    const out = createCanvas(image.width, image.height);
    const octx = out.getContext("2d");
    octx.drawImage(image, 0, 0);
    const data = octx.getImageData(0, 0, image.width, image.height).data;
    let black = 0;
    for (let i = 0; i < data.length; i += 4) {
      assert.ok(data[i] === 0 || data[i] === 255, `не 1 бит: ${data[i]}`);
      if (data[i] === 0) black += 1;
    }
    assert.ok(black > 0, "логотип целиком белый");
  }
  assert.equal(await rasterizeLabelLogo({ bytes: new Uint8Array([1, 2, 3]), mime: "image/png" }), null);
});
