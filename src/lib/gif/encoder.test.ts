import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeGif } from "./decoder";
import { encodeGif } from "./encoder";

const palette: [number, number, number][] = [
  [0, 0, 0],
  [255, 255, 255],
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
];

function noise(n: number, colors: number, seed: number): Uint8Array {
  const a = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    a[i] = (s >>> 16) % colors;
  }
  return a;
}

test("заголовок, размеры, палитра и число кадров", () => {
  const frames = [
    { pixels: new Uint8Array(6 * 4).fill(1), delayCs: 100 },
    { pixels: noise(24, 5, 1), delayCs: 50 },
  ];
  const gif = encodeGif({ width: 6, height: 4, palette, frames, loop: 0 });
  assert.equal(gif.subarray(0, 6).toString("ascii"), "GIF89a");
  assert.equal(gif[gif.length - 1], 0x3b);
  const d = decodeGif(gif);
  assert.equal(d.width, 6);
  assert.equal(d.height, 4);
  assert.equal(d.palette.length, 8);
  assert.equal(d.loop, 0);
  assert.equal(d.frames.length, 2);
  assert.deepEqual(
    d.frames.map((f) => f.delayCs),
    [100, 50],
  );
  for (let i = 0; i < 2; i++) assert.deepEqual(d.frames[i].pixels, frames[i].pixels);
});

test("loop: null — без расширения NETSCAPE", () => {
  const gif = encodeGif({
    width: 2,
    height: 2,
    palette,
    frames: [{ pixels: new Uint8Array(4), delayCs: 10 }],
    loop: null,
  });
  assert.equal(gif.includes(Buffer.from("NETSCAPE2.0")), false);
  assert.equal(decodeGif(gif).loop, null);
});

test("двухцветная палитра: минимальный код 2", () => {
  const px = noise(100, 2, 7);
  const gif = encodeGif({
    width: 10,
    height: 10,
    palette: [palette[0], palette[1]],
    frames: [{ pixels: px, delayCs: 5 }],
  });
  assert.deepEqual(decodeGif(gif).frames[0].pixels, px);
});

test("большой кадр с шумом: сброс таблицы LZW восстанавливается точно", () => {
  const w = 200;
  const h = 200;
  const frames = [
    { pixels: noise(w * h, 5, 42), delayCs: 100 },
    { pixels: noise(w * h, 3, 99), delayCs: 100 },
  ];
  const pal = Array.from({ length: 256 }, (_, i) => [i, i, i] as [number, number, number]);
  const big = { pixels: noise(w * h, 256, 5), delayCs: 7 };
  const gif = encodeGif({ width: w, height: h, palette: pal, frames: [...frames, big], loop: 0 });
  const d = decodeGif(gif);
  assert.equal(d.frames.length, 3);
  for (let i = 0; i < 2; i++) assert.deepEqual(d.frames[i].pixels, frames[i].pixels);
  assert.deepEqual(d.frames[2].pixels, big.pixels);
  assert.equal(d.frames[2].delayCs, 7);
});

test("ошибки входа: длина кадра и палитра", () => {
  assert.throws(() =>
    encodeGif({ width: 2, height: 2, palette, frames: [{ pixels: new Uint8Array(3), delayCs: 1 }] }),
  );
  assert.throws(() =>
    encodeGif({
      width: 1,
      height: 1,
      palette: Array.from({ length: 257 }, () => [0, 0, 0] as [number, number, number]),
      frames: [{ pixels: new Uint8Array(1), delayCs: 1 }],
    }),
  );
});

test("разностные кадры: наложение прямоугольников даёт полные кадры", () => {
  const w = 20;
  const h = 10;
  const f0 = noise(w * h, 5, 3);
  const f1 = Uint8Array.from(f0);
  const rect = { left: 4, top: 2, width: 6, height: 3 };
  const part = noise(rect.width * rect.height, 5, 8);
  for (let y = 0; y < rect.height; y++) {
    f1.set(part.subarray(y * rect.width, (y + 1) * rect.width), (rect.top + y) * w + rect.left);
  }
  const gif = encodeGif({
    width: w,
    height: h,
    palette,
    frames: [
      { pixels: f0, delayCs: 100 },
      { pixels: part, delayCs: 100, rect },
    ],
  });
  const d = decodeGif(gif);
  assert.deepEqual(d.frames[0].full, f0);
  assert.deepEqual(d.frames[1].full, f1);
  assert.deepEqual(d.frames[1].rect, rect);
  assert.throws(() =>
    encodeGif({ width: w, height: h, palette, frames: [{ pixels: part, delayCs: 1, rect: { ...rect, left: 18 } }] }),
  );
});
