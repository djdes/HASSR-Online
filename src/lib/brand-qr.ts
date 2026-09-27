import fs from "node:fs";
import path from "node:path";

import type { jsPDF } from "jspdf";
import QRCode from "qrcode";

import {
  BRAND_QR_CAPTION_ASPECT,
  BRAND_QR_PLATE_GAP,
  BRAND_QR_PLATE_HEIGHT,
} from "@/lib/brand-qr-shared";

/**
 * Фирменный QR WeSetup (2026-09-26) — ОДИН помощник для всех мест, где
 * сайт выдаёт QR: плакаты и наклейки журналов и объектов, личный вход,
 * QR для проверяющих (портал, лист A4, сертификат), приглашения и
 * сопряжение сотрудников, планшет-киоск, шаблоны журналов (Word),
 * QR в шапке печатного журнала и наклейка на лендинге.
 *
 * Вид (уточнение владельца: коды печатают на ЧЁРНО-БЕЛОМ принтере):
 *   • модули и «глаза» — чёрные: цветные «глаза» в ч/б печати становятся
 *     средне-серыми и хуже читаются; модули и «глаза» — квадратные:
 *     скруглённые «глаза» OpenCV не находит вовсе (проверка в
 *     `.agent/tasks/qr-brand-2026-09`: 0 % против 100 % у квадратных);
 *   • коррекция ошибок H; по центру — знак сайта (`src/app/icon.png`, тот
 *     же, что фавикон) на белой скруглённой подложке не больше 20 % ширины
 *     матрицы; модули, чей центр под подложкой, не рисуются;
 *   • снизу — плашка с градиентом серый→чёрный и белой надписью
 *     «Отсканировать» / «wesetup.ru».
 *
 * Варианты:
 *   • `full` (по умолчанию) — всё выше; `caption: false` — без плашки
 *     (наклейка лендинга: подпись даёт её золотая рамка);
 *   • `compact` — маленький печатный QR в подвале шаблона Word (18 мм):
 *     коррекция M, без логотипа и плашки. С логотипом код пришлось бы
 *     поднять до H, матрица стала бы плотнее, а модуль — меньше 0,3 мм.
 *     Печатный журнал (PDF) с 2026-09-27 — полный вариант в шапке
 *     (`drawBrandQrTilePdf`): там плитка ~17–20 мм, модуль не меньше 0,35 мм.
 *
 * Выходы: SVG (HTML и печать из браузера), PNG / data URL (диалоги,
 * сертификат PDF, Word), векторная плитка jsPDF (QR в шапке журнала).
 * Адрес внутри кода помощник не меняет.
 *
 * Server-only: `qrcode`, `node:fs`, `@napi-rs/canvas`. Клиенту — пропорции
 * из `@/lib/brand-qr-shared`.
 */

export type BrandQrVariant = "full" | "compact";

export type BrandQrOptions = {
  /** `full` (по умолчанию) или `compact` — см. выше. */
  variant?: BrandQrVariant;
  /** Только `full`: плашка «Отсканировать» снизу. По умолчанию — есть. */
  caption?: boolean;
};

export const BRAND_QR_CAPTION_TITLE = "Отсканировать";
export const BRAND_QR_CAPTION_SITE = "wesetup.ru";
/** Модули и «глаза»: чистый чёрный — ч/б принтер печатает его сплошным тонером. */
export const BRAND_QR_INK = "#000000";
const PAPER = "#ffffff";
/** Градиент плашки сверху вниз: серый `text-muted` → почти чёрный `dark-hero` дизайн-системы. */
export const BRAND_QR_PLATE_FROM = "#6f7282";
export const BRAND_QR_PLATE_TO = "#0b1024";

/** Тихая зона полного варианта вокруг матрицы, модулей. */
export const BRAND_QR_FULL_QUIET = 2;
/** Как у прежних PNG шаблона Word (`margin: 1`). */
const COMPACT_QUIET = 1;
/** Подложка логотипа — не больше этой доли стороны матрицы. */
const LOGO_MAX_SHARE = 0.2;
const PAD_RADIUS = 0.3;
const MARK_INSET = 0.09;
const PLATE_RADIUS = 0.3;
const PLATE_PAD_X = 0.05;
const PLATE_STRIPES = 24;
/**
 * Ширина надписей в em у DejaVu Sans Bold — самого широкого из шрифтов,
 * которыми они рисуются (PNG — DejaVu, SVG — системный шрифт браузера):
 * по ней кегль подбирается так, чтобы строка точно влезла в плашку.
 */
const TITLE_EM = 8.69;
const SITE_EM = 6.37;
const CAPS_ASCENT = 0.75;
const DESCENT = 0.22;
const SITE_ASCENT = 0.7;

/**
 * Знак в `src/app/icon.png` (192×192): квадрат вокруг блокнота с «С»;
 * белая плитка иконки и её тень остаются снаружи — подложку рисуем сами.
 */
const MARK_CROP = { x: 36, y: 34, size: 126 };
const ICON_CANDIDATES = [
  path.join(process.cwd(), "src", "app", "icon.png"),
  // Тот же файл (побайтно) среди PWA-иконок.
  path.join(process.cwd(), "public", "icons", "icon-192.png"),
];
const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf-fonts");
const FONT_BOLD = "WeSetupQrBold";

export type BrandQrBox = { x: number; y: number; w: number; h: number; r: number };
export type BrandQrText = { text: string; x: number; y: number; size: number };

/** Раскладка плитки; единица — модуль, начало — левый верхний угол плитки. */
export type BrandQrLayout = {
  url: string;
  variant: BrandQrVariant;
  errorCorrection: "H" | "M";
  version: number;
  /** Сторона матрицы, модулей. */
  size: number;
  /** Тихая зона вокруг матрицы (слева, сверху, справа и до плашки), модулей. */
  quiet: number;
  /** Плитка: ширина = size + 2·quiet, высота — с плашкой или без. */
  width: number;
  height: number;
  /** Модуль тёмный по стандарту (до выреза под логотип). */
  dark: (row: number, col: number) => boolean;
  /** Модуль рисуется: тёмный и центр не под подложкой логотипа. */
  plain: (row: number, col: number) => boolean;
  pad: BrandQrBox | null;
  mark: BrandQrBox | null;
  plate: BrandQrBox | null;
  title: BrandQrText | null;
  site: BrandQrText | null;
};

/** Матрица QR с коррекцией варианта (`full` — H, `compact` — M). */
export function brandQrMatrix(url: string, options: BrandQrOptions = {}): QRCode.QRCode {
  return QRCode.create(url, { errorCorrectionLevel: (options.variant ?? "full") === "full" ? "H" : "M" });
}

/** Сторона подложки логотипа, модулей: нечётная (ровно по центру матрицы), ≤ 20 %. */
export function brandQrPadModules(size: number): number {
  let k = Math.floor(size * LOGO_MAX_SHARE);
  if (k % 2 === 0) k -= 1;
  return Math.max(k, 3);
}

/** Точка внутри скруглённого квадрата [x0, x0+k]² радиуса r. */
function insideRounded(px: number, py: number, x0: number, y0: number, k: number, r: number): boolean {
  const dx = Math.max(x0 + r - px, 0, px - (x0 + k - r));
  const dy = Math.max(y0 + r - py, 0, py - (y0 + k - r));
  if (px < x0 || px > x0 + k || py < y0 || py > y0 + k) return false;
  return dx * dx + dy * dy <= r * r;
}

export function brandQrLayout(url: string, options: BrandQrOptions = {}): BrandQrLayout {
  const variant = options.variant ?? "full";
  const full = variant === "full";
  const qr = brandQrMatrix(url, { variant });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const quiet = full ? BRAND_QR_FULL_QUIET : COMPACT_QUIET;
  const width = size + 2 * quiet;
  const withCaption = full && options.caption !== false;
  const height = withCaption ? width * BRAND_QR_CAPTION_ASPECT : width;
  const dark = (row: number, col: number) => data[row * size + col] === 1;

  if (!full) {
    return {
      url,
      variant,
      errorCorrection: "M",
      version: qr.version,
      size,
      quiet,
      width,
      height,
      dark,
      plain: dark,
      pad: null,
      mark: null,
      plate: null,
      title: null,
      site: null,
    };
  }

  const k = brandQrPadModules(size);
  const start = (size - k) / 2;
  const padRadius = k * PAD_RADIUS;
  const underPad = (row: number, col: number) => insideRounded(col + 0.5, row + 0.5, start, start, k, padRadius);
  const pad: BrandQrBox = { x: quiet + start, y: quiet + start, w: k, h: k, r: padRadius };
  const inset = k * MARK_INSET;
  const mark: BrandQrBox = { x: pad.x + inset, y: pad.y + inset, w: k - 2 * inset, h: k - 2 * inset, r: 0 };

  let plate: BrandQrBox | null = null;
  let title: BrandQrText | null = null;
  let site: BrandQrText | null = null;
  if (withCaption) {
    const plateY = width * (1 + BRAND_QR_PLATE_GAP);
    const plateH = width * BRAND_QR_PLATE_HEIGHT;
    plate = { x: quiet, y: plateY, w: size, h: plateH, r: plateH * PLATE_RADIUS };
    const innerW = size - 2 * width * PLATE_PAD_X;
    const titleSize = Math.min(plateH * 0.4, innerW / TITLE_EM);
    const siteSize = Math.min(plateH * 0.26, innerW / SITE_EM);
    const gap = plateH * 0.08;
    // Блок из двух строк — по центру плашки (сверху заглавная «О», снизу хвост «р»).
    const block = CAPS_ASCENT * titleSize + DESCENT * titleSize + gap + SITE_ASCENT * siteSize + DESCENT * siteSize;
    const titleBaseline = plateY + (plateH - block) / 2 + CAPS_ASCENT * titleSize;
    const siteBaseline = titleBaseline + DESCENT * titleSize + gap + SITE_ASCENT * siteSize;
    const cx = quiet + size / 2;
    title = { text: BRAND_QR_CAPTION_TITLE, x: cx, y: titleBaseline, size: titleSize };
    site = { text: BRAND_QR_CAPTION_SITE, x: cx, y: siteBaseline, size: siteSize };
  }

  return {
    url,
    variant,
    errorCorrection: "H",
    version: qr.version,
    size,
    quiet,
    width,
    height,
    dark,
    plain: (row, col) => dark(row, col) && !underPad(row, col),
    pad,
    mark,
    plate,
    title,
    site,
  };
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

const num = (value: number) => String(Math.round(value * 1000) / 1000);

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Часть скруглённой плашки ниже линии `t`. Градиент в SVG — полосами из
 * таких частей (каждая следующая темнее и перекрывает предыдущую): без
 * `<linearGradient id>`. Один и тот же SVG стоит на странице дважды
 * (карточка и печатный лист), а ссылка `url(#id)` ведёт на ПЕРВЫЙ элемент
 * с этим id — в печати он внутри скрытой карточки, и Chrome не рисует
 * градиент из-под `display: none`: плашка пропала бы с листа.
 */
function plateBelow(box: BrandQrBox, t: number): string {
  const { x, y, w, h, r } = box;
  const top = Math.max(t, y);
  const insetAt = (py: number) => {
    let dy = 0;
    if (py < y + r) dy = y + r - py;
    else if (py > y + h - r) dy = py - (y + h - r);
    else return 0;
    return r - Math.sqrt(Math.max(0, r * r - dy * dy));
  };
  const inset = insetAt(top);
  const a = `A${num(r)} ${num(r)} 0 0 1 `;
  let d = `M${num(x + inset)} ${num(top)}H${num(x + w - inset)}`;
  if (top < y + h - r) {
    if (top < y + r) d += `${a}${num(x + w)} ${num(y + r)}`;
    d += `V${num(y + h - r)}${a}${num(x + w - r)} ${num(y + h)}H${num(x + r)}${a}${num(x)} ${num(y + h - r)}`;
    d += top < y + r ? `V${num(y + r)}${a}${num(x + inset)} ${num(top)}` : `V${num(top)}`;
  } else {
    d += `${a}${num(x + w - r)} ${num(y + h)}H${num(x + r)}${a}${num(x + inset)} ${num(top)}`;
  }
  return `${d}Z`;
}

function hex(rgb: number[]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function rgbOf(color: string): number[] {
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
}

function plateStripes(box: BrandQrBox): string {
  const from = rgbOf(BRAND_QR_PLATE_FROM);
  const to = rgbOf(BRAND_QR_PLATE_TO);
  let out = "";
  for (let i = 0; i < PLATE_STRIPES; i += 1) {
    const mix = (i + 0.5) / PLATE_STRIPES;
    const color = hex(from.map((c, j) => c + (to[j] - c) * mix));
    out += `<path fill="${color}" d="${plateBelow(box, box.y + (box.h * i) / PLATE_STRIPES)}"/>`;
  }
  return out;
}

/** Тёмные модули — строками штриха толщиной в модуль, как у библиотеки qrcode (компактно). */
function modulesPath(layout: BrandQrLayout): string {
  let d = "";
  for (let row = 0; row < layout.size; row += 1) {
    let pen: number | null = null;
    let col = 0;
    while (col < layout.size) {
      if (!layout.plain(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < layout.size && layout.plain(row, col)) col += 1;
      const x = layout.quiet + start;
      d += pen === null ? `M${x} ${num(layout.quiet + row + 0.5)}` : `m${x - pen} 0`;
      d += `h${col - start}`;
      pen = x + (col - start);
    }
  }
  return d;
}

let markDataUrlPromise: Promise<string | null> | null = null;

/** Знак сайта для SVG: вырез из `icon.png` на белом, JPEG (≈ 7 КБ в base64 — легче PNG вдвое). */
function markDataUrl(): Promise<string | null> {
  markDataUrlPromise ??= (async () => {
    const icon = await loadIcon();
    if (!icon) return null;
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(MARK_CROP.size, MARK_CROP.size);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, MARK_CROP.size, MARK_CROP.size);
    ctx.drawImage(icon, MARK_CROP.x, MARK_CROP.y, MARK_CROP.size, MARK_CROP.size, 0, 0, MARK_CROP.size, MARK_CROP.size);
    return `data:image/jpeg;base64,${canvas.toBuffer("image/jpeg", 90).toString("base64")}`;
  })().catch(() => null);
  return markDataUrlPromise;
}

/**
 * SVG плитки. `width`/`height` — в px (как у прежних SVG библиотеки
 * qrcode); на странице размер задаёт CSS, на печати — мм (`viewBox`
 * сохраняет пропорции плитки). Без `id` внутри — см. `plateBelow`.
 */
export async function brandQrSvg(url: string, options: BrandQrOptions = {}): Promise<string> {
  const layout = brandQrLayout(url, options);
  const markHref = layout.mark ? await markDataUrl() : null;
  return renderBrandQrSvg(layout, markHref);
}

function renderBrandQrSvg(layout: BrandQrLayout, markHref: string | null): string {
  const pxWidth = 600;
  const pxHeight = Math.round((pxWidth * layout.height) / layout.width);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pxWidth}" height="${pxHeight}" viewBox="0 0 ${num(layout.width)} ${num(layout.height)}" role="img" aria-label="QR-код WeSetup">`,
    `<rect width="${num(layout.width)}" height="${num(layout.height)}" fill="${PAPER}"/>`,
    `<path fill="none" stroke="${BRAND_QR_INK}" stroke-width="1" shape-rendering="crispEdges" d="${modulesPath(layout)}"/>`,
  ];
  if (layout.pad) {
    const p = layout.pad;
    parts.push(`<rect x="${num(p.x)}" y="${num(p.y)}" width="${num(p.w)}" height="${num(p.h)}" rx="${num(p.r)}" fill="${PAPER}"/>`);
  }
  if (layout.mark && markHref) {
    const m = layout.mark;
    parts.push(
      `<image x="${num(m.x)}" y="${num(m.y)}" width="${num(m.w)}" height="${num(m.h)}" preserveAspectRatio="xMidYMid meet" href="${escapeXml(markHref)}"/>`
    );
  }
  if (layout.plate) parts.push(plateStripes(layout.plate));
  const font = `font-family="'Segoe UI','Helvetica Neue',Arial,'DejaVu Sans',sans-serif" fill="${PAPER}" text-anchor="middle"`;
  if (layout.title) {
    const t = layout.title;
    parts.push(`<text x="${num(t.x)}" y="${num(t.y)}" font-size="${num(t.size)}" font-weight="700" ${font}>${escapeXml(t.text)}</text>`);
  }
  if (layout.site) {
    const s = layout.site;
    parts.push(`<text x="${num(s.x)}" y="${num(s.y)}" font-size="${num(s.size)}" font-weight="600" ${font}>${escapeXml(s.text)}</text>`);
  }
  parts.push("</svg>");
  return parts.join("");
}

// ---------------------------------------------------------------------------
// PNG (@napi-rs/canvas)
// ---------------------------------------------------------------------------

type CanvasModule = typeof import("@napi-rs/canvas");
type CanvasImage = Awaited<ReturnType<CanvasModule["loadImage"]>>;
type Ctx = ReturnType<ReturnType<CanvasModule["createCanvas"]>["getContext"]>;

let iconPromise: Promise<CanvasImage | null> | null = null;

function loadIcon(): Promise<CanvasImage | null> {
  iconPromise ??= (async () => {
    const file = ICON_CANDIDATES.find((candidate) => fs.existsSync(candidate));
    if (!file) return null;
    const { loadImage } = await import("@napi-rs/canvas");
    return loadImage(fs.readFileSync(file));
  })().catch(() => null);
  return iconPromise;
}

let fontsReady = false;

/** DejaVu Sans Bold из репозитория — одинаковый шрифт на Windows и на сервере. */
function ensureFonts(canvas: CanvasModule): string {
  if (!fontsReady) {
    fontsReady = true;
    const bold = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");
    if (fs.existsSync(bold)) canvas.GlobalFonts.registerFromPath(bold, FONT_BOLD);
  }
  return canvas.GlobalFonts.has(FONT_BOLD) ? FONT_BOLD : "sans-serif";
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fitText(ctx: Ctx, family: string, text: BrandQrText, scale: number, maxWidth: number) {
  let px = text.size * scale;
  ctx.font = `${px}px ${family}`;
  const width = ctx.measureText(text.text).width;
  if (width > maxWidth) {
    px *= maxWidth / width;
    ctx.font = `${px}px ${family}`;
  }
  ctx.fillText(text.text, text.x * scale, text.y * scale);
}

/**
 * PNG плитки. `width` — желаемая ширина, px: модуль — целое число
 * пикселей (чёткие края), поэтому итог не уже `width` и кратен ширине
 * плитки в модулях. Высота — по пропорции варианта.
 */
export async function brandQrPng(url: string, options: BrandQrOptions & { width?: number } = {}): Promise<Buffer> {
  const layout = brandQrLayout(url, options);
  const canvasModule = await import("@napi-rs/canvas");
  const scale = Math.max(1, Math.ceil((options.width ?? 600) / layout.width));
  const w = layout.width * scale;
  const h = Math.round(layout.height * scale);
  const canvas = canvasModule.createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = BRAND_QR_INK;
  for (let row = 0; row < layout.size; row += 1) {
    let col = 0;
    while (col < layout.size) {
      if (!layout.plain(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < layout.size && layout.plain(row, col)) col += 1;
      ctx.fillRect((layout.quiet + start) * scale, (layout.quiet + row) * scale, (col - start) * scale, scale);
    }
  }

  if (layout.pad) {
    const p = layout.pad;
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    roundedRect(ctx, p.x * scale, p.y * scale, p.w * scale, p.h * scale, p.r * scale);
    ctx.fill();
  }
  if (layout.mark) {
    const icon = await loadIcon();
    if (icon) {
      const m = layout.mark;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(icon, MARK_CROP.x, MARK_CROP.y, MARK_CROP.size, MARK_CROP.size, m.x * scale, m.y * scale, m.w * scale, m.h * scale);
    }
  }

  if (layout.plate) {
    const p = layout.plate;
    const gradient = ctx.createLinearGradient(0, p.y * scale, 0, (p.y + p.h) * scale);
    gradient.addColorStop(0, BRAND_QR_PLATE_FROM);
    gradient.addColorStop(1, BRAND_QR_PLATE_TO);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    roundedRect(ctx, p.x * scale, p.y * scale, p.w * scale, p.h * scale, p.r * scale);
    ctx.fill();
    const family = ensureFonts(canvasModule);
    const maxWidth = (p.w - 2 * layout.width * PLATE_PAD_X) * scale;
    ctx.fillStyle = PAPER;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    if (layout.title) fitText(ctx, family, layout.title, scale, maxWidth);
    if (layout.site) fitText(ctx, family, layout.site, scale, maxWidth);
  }
  return canvas.toBuffer("image/png");
}

export async function brandQrPngDataUrl(url: string, options: BrandQrOptions & { width?: number } = {}): Promise<string> {
  return `data:image/png;base64,${(await brandQrPng(url, options)).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// jsPDF (вектор)
// ---------------------------------------------------------------------------

/** Имя картинки знака в PDF: jsPDF кладёт её в файл один раз на весь документ. */
const PDF_MARK_ALIAS = "wesetup-brand-qr-mark";

type IconPng = { bytes: Uint8Array; width: number; height: number };
let iconPngCache: IconPng | null | undefined;

/** `icon.png` как есть (синхронно — отрисовка jsPDF синхронная); размер — из заголовка PNG. */
function iconPng(): IconPng | null {
  if (iconPngCache !== undefined) return iconPngCache;
  const file = ICON_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  const bytes = file ? fs.readFileSync(file) : null;
  iconPngCache =
    bytes && bytes.length > 24 ? { bytes: new Uint8Array(bytes), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null;
  return iconPngCache;
}

export type BrandQrPdfBox = { x: number; y: number; width: number; height: number; module: number };

/**
 * Полный фирменный QR векторно в jsPDF — QR в шапке печатного журнала.
 *
 * Та же плитка, что у PNG и SVG (`brandQrLayout`, вариант `full`): тихая
 * зона, чёрные квадратные модули и «глаза», белая скруглённая подложка со
 * знаком сайта, плашка с градиентом серый→чёрный и белыми «Отсканировать» /
 * «wesetup.ru». (x, y) — левый верхний угол плитки, `width` — её ширина с
 * тихой зоной, мм; высота — по пропорции плитки.
 *
 * Модули, подложка, плашка и надписи — вектор (чётко на любом принтере):
 * подряд идущие модули строки — одним прямоугольником; градиент — как в SVG,
 * `PLATE_STRIPES` полос внутри скруглённого контура плашки (обрезка по
 * пути). Знак — `icon.png`: вырез `MARK_CROP` — тоже обрезкой, картинка одна
 * на документ. `fontName` — шрифт документа с кириллицей; надписи —
 * его жирным начертанием, кегль подбирается, чтобы строка влезла в плашку.
 */
export function drawBrandQrTilePdf(
  doc: jsPDF,
  layout: BrandQrLayout,
  x: number,
  y: number,
  width: number,
  options: { fontName: string },
): BrandQrPdfBox {
  if (layout.variant !== "full") throw new Error("Плитка PDF — только полный фирменный QR");
  const u = width / layout.width;
  const height = layout.height * u;
  const font = doc.getFont();
  const fontSize = doc.getFontSize();
  const textColor = doc.getTextColor();
  const fillColor = doc.getFillColor();

  // Белая плитка: тихая зона кода и поле вокруг плашки.
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, width, height, "F");

  doc.setFillColor(0, 0, 0);
  const n = layout.size;
  for (let row = 0; row < n; row += 1) {
    let col = 0;
    while (col < n) {
      if (!layout.plain(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < n && layout.plain(row, col)) col += 1;
      // +0,01 мм — без «волосяных» щелей между соседними строками.
      doc.rect(x + (layout.quiet + start) * u, y + (layout.quiet + row) * u, (col - start) * u, u + 0.01, "F");
    }
  }

  if (layout.pad) {
    const p = layout.pad;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x + p.x * u, y + p.y * u, p.w * u, p.h * u, p.r * u, p.r * u, "F");
  }
  const icon = layout.mark ? iconPng() : null;
  if (layout.mark && icon) {
    const m = layout.mark;
    const scale = (m.w * u) / MARK_CROP.size;
    doc.saveGraphicsState();
    doc.rect(x + m.x * u, y + m.y * u, m.w * u, m.h * u, null);
    doc.clip();
    doc.discardPath();
    doc.addImage(
      icon.bytes,
      "PNG",
      x + m.x * u - MARK_CROP.x * scale,
      y + m.y * u - MARK_CROP.y * scale,
      icon.width * scale,
      icon.height * scale,
      PDF_MARK_ALIAS,
      // Без сжатия jsPDF кладёт картинку с альфой как есть — ~110 КБ на
      // документ; со сжатием — ~9 КБ.
      "FAST",
    );
    doc.restoreGraphicsState();
  }

  if (layout.plate) {
    const p = layout.plate;
    const px = x + p.x * u;
    const py = y + p.y * u;
    const pw = p.w * u;
    const ph = p.h * u;
    const from = rgbOf(BRAND_QR_PLATE_FROM);
    const to = rgbOf(BRAND_QR_PLATE_TO);
    doc.saveGraphicsState();
    doc.roundedRect(px, py, pw, ph, p.r * u, p.r * u, null);
    doc.clip();
    doc.discardPath();
    for (let i = 0; i < PLATE_STRIPES; i += 1) {
      const mix = (i + 0.5) / PLATE_STRIPES;
      const [r, g, b] = from.map((c, j) => Math.round(c + (to[j] - c) * mix));
      doc.setFillColor(r, g, b);
      // Как в SVG: полоса — вся часть плашки ниже своей линии, следующая
      // (темнее) ложится сверху. Стыков между полосами нет — нет и светлых
      // «волосков» от сглаживания краёв.
      const top = py + (ph * i) / PLATE_STRIPES;
      doc.rect(px, top, pw, py + ph - top, "F");
    }
    doc.restoreGraphicsState();

    const maxWidth = (p.w - 2 * layout.width * PLATE_PAD_X) * u;
    doc.setTextColor(255, 255, 255);
    doc.setFont(options.fontName, "bold");
    for (const text of [layout.title, layout.site]) {
      if (!text) continue;
      const size = (text.size * u * 72) / 25.4;
      doc.setFontSize(size);
      const textWidth = doc.getTextWidth(text.text);
      if (textWidth > maxWidth) doc.setFontSize((size * maxWidth) / textWidth);
      doc.text(text.text, x + text.x * u, y + text.y * u, { align: "center", baseline: "alphabetic" });
    }
  }

  doc.setFont(font.fontName, font.fontStyle);
  doc.setFontSize(fontSize);
  doc.setTextColor(textColor);
  doc.setFillColor(fillColor);
  return { x, y, width, height, module: u };
}
