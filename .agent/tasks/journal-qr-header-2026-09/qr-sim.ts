/**
 * «Как снимет телефон / ч/б принтер» — растры QR с листа PDF и два
 * независимых декодера. Общий модуль проверок задачи (decode-matrix.ts,
 * size-experiment.ts).
 *
 *   • растр участка страницы pdf.js в заданном dpi (реальный размер);
 *   • ч/б: перевод в серый + порог 50 % — сразу на снимке (как ч/б скан) и
 *     «ч/б принтер»: серый + порог при 600 dpi (тонер есть/нет), потом снимок;
 *   • «телефон»: лист при 600 dpi → перспектива (наклон) + поворот → снимок
 *     в заданном dpi с усреднением 3 × 3 → размытие по Гауссу → JPEG;
 *   • декодеры: jsQR (npm) и zxing-cpp (npm zxing-wasm) — только во временной
 *     папке QR_VERIFY_DIR (по умолчанию C:/wt/_verify-pdfqr), не в проекте.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

export const VERIFY_DIR = path.resolve(process.env.QR_VERIFY_DIR ?? "C:/wt/_verify-pdfqr");

export type Raster = { width: number; height: number; data: Uint8ClampedArray };
export type BoxMm = { x0: number; y0: number; x1: number; y1: number };

// ---------------------------------------------------------------------------
// pdf.js
// ---------------------------------------------------------------------------

type PdfJsDoc = {
  numPages: number;
  getPage(n: number): Promise<{
    getViewport(o: { scale: number; offsetX?: number; offsetY?: number }): { width: number; height: number };
    render(o: unknown): { promise: Promise<void> };
    getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
    cleanup(): void;
  }>;
  /** Закрыть документ pdf.js (освободить память). */
  close(): Promise<void>;
};

export async function openPdf(pdf: Buffer | Uint8Array): Promise<PdfJsDoc> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);
  const doc = (await task.promise) as unknown as PdfJsDoc;
  doc.close = () => task.destroy();
  return doc;
}

/** Размер страницы, мм. */
export async function pageSizeMm(doc: PdfJsDoc, pageNumber: number): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  return { width: (base.width / 72) * 25.4, height: (base.height / 72) * 25.4 };
}

/** Участок страницы (мм) растром dpi — белый фон, сглаживание pdf.js (как усреднение по пикселю). */
export async function renderRegion(
  doc: PdfJsDoc,
  pageNumber: number,
  box: BoxMm,
  dpi: number,
  options: { snap?: boolean } = {},
): Promise<Raster> {
  const page = await doc.getPage(pageNumber);
  const scale = dpi / 72;
  const pxPerMm = dpi / 25.4;
  // Сетка пикселей — от края листа, как у принтера и сканера: границы участка
  // округляются до пикселя этой сетки. Иначе сетка «привязана» к самому QR
  // (кадр считается от плитки), и фаза модулей относительно пикселей у всех
  // бланков одна и та же, неестественно ровная. `snap: false` — кадр как
  // задан, с дробным сдвигом (опыт с фазой сетки, phase-sweep.ts).
  const snap = options.snap !== false;
  const px0 = snap ? Math.floor(box.x0 * pxPerMm + 1e-6) : box.x0 * pxPerMm;
  const py0 = snap ? Math.floor(box.y0 * pxPerMm + 1e-6) : box.y0 * pxPerMm;
  const width = Math.max(1, snap ? Math.ceil(box.x1 * pxPerMm - 1e-6) - px0 : Math.round((box.x1 - box.x0) * pxPerMm));
  const height = Math.max(1, snap ? Math.ceil(box.y1 * pxPerMm - 1e-6) - py0 : Math.round((box.y1 - box.y0) * pxPerMm));
  const viewport = page.getViewport({ scale, offsetX: -px0, offsetY: -py0 });
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
  const img = ctx.getImageData(0, 0, width, height);
  page.cleanup();
  return { width, height, data: img.data };
}

// ---------------------------------------------------------------------------
// Преобразования
// ---------------------------------------------------------------------------

const lum = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

export function toGray(r: Raster): Raster {
  const out = new Uint8ClampedArray(r.data.length);
  for (let i = 0; i < r.data.length; i += 4) {
    const v = lum(r.data, i);
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return { width: r.width, height: r.height, data: out };
}

/** Серый + порог (по умолчанию 50 %): чёрное/белое, как тонер ч/б принтера. */
export function threshold(r: Raster, level = 128): Raster {
  const out = new Uint8ClampedArray(r.data.length);
  for (let i = 0; i < r.data.length; i += 4) {
    const v = lum(r.data, i) < level ? 0 : 255;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return { width: r.width, height: r.height, data: out };
}

/** Уменьшение в целое число раз усреднением (камера интегрирует свет по пикселю). */
export function downsample(r: Raster, factor: number): Raster {
  const width = Math.floor(r.width / factor);
  const height = Math.floor(r.height / factor);
  const out = new Uint8ClampedArray(width * height * 4);
  const n = factor * factor;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          const i = ((y * factor + dy) * r.width + (x * factor + dx)) * 4;
          s0 += r.data[i];
          s1 += r.data[i + 1];
          s2 += r.data[i + 2];
        }
      }
      const o = (y * width + x) * 4;
      out[o] = s0 / n;
      out[o + 1] = s1 / n;
      out[o + 2] = s2 / n;
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

export function gaussianBlur(r: Raster, sigma: number): Raster {
  if (sigma <= 0) return r;
  const radius = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= sum;
  const pass = (src: Uint8ClampedArray, horizontal: boolean) => {
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < r.height; y += 1) {
      for (let x = 0; x < r.width; x += 1) {
        let a = 0;
        let b = 0;
        let c = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const sx = horizontal ? Math.min(r.width - 1, Math.max(0, x + k)) : x;
          const sy = horizontal ? y : Math.min(r.height - 1, Math.max(0, y + k));
          const i = (sy * r.width + sx) * 4;
          const w = kernel[k + radius];
          a += src[i] * w;
          b += src[i + 1] * w;
          c += src[i + 2] * w;
        }
        const o = (y * r.width + x) * 4;
        out[o] = a;
        out[o + 1] = b;
        out[o + 2] = c;
        out[o + 3] = 255;
      }
    }
    return out;
  };
  return { width: r.width, height: r.height, data: pass(pass(r.data, true), false) };
}

/** Гомография по четырём парам точек: from[i] → to[i]. */
function homography(from: [number, number][], to: [number, number][]): number[] {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // Гаусс с выбором ведущего элемента.
  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 8; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let row = 0; row < 8; row += 1) {
      if (row === col) continue;
      const f = a[row][col] / a[col][col];
      for (let k = col; k < 8; k += 1) a[row][k] -= f * a[col][k];
      b[row] -= f * b[col];
    }
  }
  return [...b.map((v, i) => v / a[i][i]), 1];
}

function sampleBilinear(r: Raster, x: number, y: number, out: number[]) {
  if (x < 0 || y < 0 || x > r.width - 1 || y > r.height - 1) {
    out[0] = out[1] = out[2] = 255;
    return;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(r.width - 1, x0 + 1);
  const y1 = Math.min(r.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  for (let c = 0; c < 3; c += 1) {
    const p00 = r.data[(y0 * r.width + x0) * 4 + c];
    const p10 = r.data[(y0 * r.width + x1) * 4 + c];
    const p01 = r.data[(y1 * r.width + x0) * 4 + c];
    const p11 = r.data[(y1 * r.width + x1) * 4 + c];
    out[c] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
  }
}

export type PhoneOptions = {
  /** Поворот, градусы. */
  angle: number;
  /** Перспектива: верхний край кадра уже нижнего на эту долю (телефон наклонён). */
  keystone: number;
  /** Размытие (σ, px снимка). */
  blur: number;
  /** Качество JPEG, 0–100; 0 — без JPEG. */
  jpeg: number;
};

/**
 * Acceptance "phone": light blur (sigma 0.6 px), rotation 5-10 deg (the caller
 * picks the angle), perspective 4 % (phone tilted ~15-20 deg at 15 cm), JPEG 90.
 */
export const PHONE: PhoneOptions = { angle: 7, keystone: 0.04, blur: 0.6, jpeg: 90 };
/** Stress: perspective 8 %, blur sigma 0.8 px, JPEG 85 (harsher than the spec). */
export const PHONE_HARD: PhoneOptions = { angle: 7, keystone: 0.08, blur: 0.8, jpeg: 85 };

/**
 * «Снимок телефоном»: `master` — участок листа при `masterDpi`; результат —
 * снимок при `dpi` (разрешение в середине кадра), повёрнутый и с
 * перспективой, размытый, пережатый JPEG.
 */
export async function phoneCapture(master: Raster, masterDpi: number, dpi: number, o: PhoneOptions = PHONE): Promise<Raster> {
  const s = dpi / masterDpi;
  const w = master.width * s;
  const h = master.height * s;
  // Прямоугольник листа → трапеция (верх уже) → поворот вокруг центра.
  const k = (o.keystone * w) / 2;
  const quad: [number, number][] = [
    [k, h * 0.03],
    [w - k, h * 0.03],
    [w, h],
    [0, h],
  ];
  const rad = (o.angle * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  const rotated = quad.map(([x, y]) => [
    cx + (x - cx) * Math.cos(rad) - (y - cy) * Math.sin(rad),
    cy + (x - cx) * Math.sin(rad) + (y - cy) * Math.cos(rad),
  ]) as [number, number][];
  const minX = Math.min(...rotated.map((p) => p[0]));
  const minY = Math.min(...rotated.map((p) => p[1]));
  const maxX = Math.max(...rotated.map((p) => p[0]));
  const maxY = Math.max(...rotated.map((p) => p[1]));
  const pad = 6;
  const dst = rotated.map(([x, y]) => [x - minX + pad, y - minY + pad]) as [number, number][];
  const width = Math.ceil(maxX - minX + 2 * pad);
  const height = Math.ceil(maxY - minY + 2 * pad);
  const src: [number, number][] = [
    [0, 0],
    [master.width - 1, 0],
    [master.width - 1, master.height - 1],
    [0, master.height - 1],
  ];
  const hm = homography(dst, src);
  const out = new Uint8ClampedArray(width * height * 4);
  const px = [0, 0, 0];
  const SUB = 3;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let a = 0;
      let b = 0;
      let c = 0;
      for (let sy = 0; sy < SUB; sy += 1) {
        for (let sx = 0; sx < SUB; sx += 1) {
          const u = x + (sx + 0.5) / SUB;
          const v = y + (sy + 0.5) / SUB;
          const d = hm[6] * u + hm[7] * v + hm[8];
          sampleBilinear(master, (hm[0] * u + hm[1] * v + hm[2]) / d, (hm[3] * u + hm[4] * v + hm[5]) / d, px);
          a += px[0];
          b += px[1];
          c += px[2];
        }
      }
      const i = (y * width + x) * 4;
      out[i] = a / (SUB * SUB);
      out[i + 1] = b / (SUB * SUB);
      out[i + 2] = c / (SUB * SUB);
      out[i + 3] = 255;
    }
  }
  let shot: Raster = gaussianBlur({ width, height, data: out }, o.blur);
  if (o.jpeg > 0) shot = await jpegRoundTrip(shot, o.jpeg);
  return shot;
}

export async function jpegRoundTrip(r: Raster, quality: number): Promise<Raster> {
  const canvas = createCanvas(r.width, r.height);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(r.width, r.height);
  img.data.set(r.data);
  ctx.putImageData(img, 0, 0);
  const jpeg = canvas.toBuffer("image/jpeg", quality);
  const back = await loadImage(jpeg);
  const c2 = createCanvas(r.width, r.height);
  const ctx2 = c2.getContext("2d");
  ctx2.drawImage(back, 0, 0);
  return { width: r.width, height: r.height, data: ctx2.getImageData(0, 0, r.width, r.height).data };
}

export function savePng(r: Raster, file: string) {
  const canvas = createCanvas(r.width, r.height);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(r.width, r.height);
  img.data.set(r.data);
  ctx.putImageData(img, 0, 0);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, canvas.toBuffer("image/png"));
}

// ---------------------------------------------------------------------------
// Декодеры
// ---------------------------------------------------------------------------

type JsQr = (data: Uint8ClampedArray, w: number, h: number) => { data: string } | null;
let jsqr: JsQr | null = null;

export function decodeJsQr(r: Raster): string | null {
  if (!jsqr) {
    const mod = createRequire(path.join(VERIFY_DIR, "package.json"))("jsqr") as { default?: JsQr } & JsQr;
    jsqr = mod.default ?? mod;
  }
  return jsqr(r.data, r.width, r.height)?.data ?? null;
}

type ZxingRead = (
  input: { data: Uint8ClampedArray; width: number; height: number },
  options: Record<string, unknown>,
) => Promise<Array<{ text: string; isValid?: boolean }>>;
let zxing: ZxingRead | null = null;

export async function decodeZxing(r: Raster): Promise<string | null> {
  if (!zxing) {
    const dir = path.join(VERIFY_DIR, "node_modules", "zxing-wasm", "dist");
    const mod = (await import(pathToFileURL(path.join(dir, "es", "reader", "index.js")).href)) as {
      readBarcodes: ZxingRead;
      prepareZXingModule: (o: unknown) => unknown;
    };
    const wasm = fs.readFileSync(path.join(dir, "reader", "zxing_reader.wasm"));
    await mod.prepareZXingModule({
      overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) },
      fireImmediately: true,
    });
    zxing = mod.readBarcodes;
  }
  const results = await zxing(
    { data: r.data, width: r.width, height: r.height },
    { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 1 },
  );
  return results.find((item) => item.isValid !== false)?.text ?? null;
}

// ---------------------------------------------------------------------------
// Набор снимков одного QR
// ---------------------------------------------------------------------------

export type ShotKind = "clean" | "bw" | "bw-print" | "phone" | "bw-phone" | "phone-hard" | "bw-phone-hard";
export type Shot = { dpi: number; kind: ShotKind; raster: Raster };

export const SHOT_KINDS: ShotKind[] = ["clean", "bw", "bw-print", "phone", "bw-phone", "phone-hard", "bw-phone-hard"];

/**
 * Снимки участка `box` страницы: для каждого dpi — чистый, ч/б (серый +
 * порог снимка), ч/б принтер (порог при 600 dpi → снимок), телефон, ч/б
 * принтер + телефон.
 */
export async function shotsOf(
  doc: PdfJsDoc,
  pageNumber: number,
  box: BoxMm,
  dpis: number[],
  options: { phone?: PhoneOptions; hard?: PhoneOptions | null } = {},
): Promise<Shot[]> {
  const MASTER = 600;
  const phone = options.phone ?? PHONE;
  // Кадр — по сетке самого грубого снимка (150 dpi, от края листа): тогда сетки
  // 600, 300 и 150 dpi совпадают с сеткой листа, как у принтера и сканера.
  const grid = 25.4 / Math.min(...dpis);
  box = {
    x0: Math.floor(box.x0 / grid + 1e-6) * grid,
    y0: Math.floor(box.y0 / grid + 1e-6) * grid,
    x1: Math.ceil(box.x1 / grid - 1e-6) * grid,
    y1: Math.ceil(box.y1 / grid - 1e-6) * grid,
  };
  const master = await renderRegion(doc, pageNumber, box, MASTER);
  const masterBw = threshold(master);
  const shots: Shot[] = [];
  for (const dpi of dpis) {
    const clean = await renderRegion(doc, pageNumber, box, dpi);
    shots.push({ dpi, kind: "clean", raster: clean });
    shots.push({ dpi, kind: "bw", raster: threshold(clean) });
    shots.push({ dpi, kind: "bw-print", raster: downsample(masterBw, MASTER / dpi) });
    shots.push({ dpi, kind: "phone", raster: await phoneCapture(master, MASTER, dpi, phone) });
    shots.push({ dpi, kind: "bw-phone", raster: await phoneCapture(masterBw, MASTER, dpi, phone) });
    if (options.hard) {
      shots.push({ dpi, kind: "phone-hard", raster: await phoneCapture(master, MASTER, dpi, options.hard) });
      shots.push({ dpi, kind: "bw-phone-hard", raster: await phoneCapture(masterBw, MASTER, dpi, options.hard) });
    }
  }
  return shots;
}
