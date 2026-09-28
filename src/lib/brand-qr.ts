import fs from "node:fs";
import path from "node:path";

import type { jsPDF } from "jspdf";
import QRCode from "qrcode";

import { BRAND_QR_CAPTION_ASPECT, BRAND_QR_FRAME, BRAND_QR_STRIP } from "@/lib/brand-qr-shared";

/**
 * Фирменный QR WeSetup — ОДИН помощник для всех мест, где сайт выдаёт QR:
 * плакаты и наклейки журналов и объектов, личный вход, QR для проверяющих
 * (портал, лист A4, сертификат), приглашения и сопряжение сотрудников,
 * планшет-киоск, шаблоны журналов (Word), QR в шапке печатного журнала и в
 * бумажном бланке, наклейка на лендинге.
 *
 * Вид (2026-09-27; владелец: «у всех чёрно-белые принтеры» — только чёрный и
 * белый, без полутонов, градиентов и цветных картинок):
 *   • модули и «глаза» — чёрные квадратные (скруглённые «глаза» OpenCV не
 *     находит: `.agent/tasks/qr-brand-2026-09`), коррекция ошибок H;
 *   • по центру — знак сайта, плоский ч/б (`MARK_SHAPES`): чёрная обложка
 *     блокнота с тремя кольцами слева и белой «C», по мотивам иконки сайта
 *     (`src/app/icon.png`); на белой скруглённой подложке не больше 20 %
 *     стороны матрицы, модули, чей центр под подложкой, не рисуются;
 *   • плитка — один чёрный блок со скруглёнными углами: тонкая рамка вокруг
 *     белого окна с кодом (тихая зона 2 модуля), снизу рамка утолщается в
 *     полосу с одним словом «Отсканировать» — белым жирным, по центру, по
 *     ширине. Адреса сайта в плитке нет: бренд узнаётся по знаку, адрес
 *     телефон покажет сам при сканировании.
 * `caption: false` — только код со знаком, без рамки и полосы (наклейка
 * лендинга: подпись даёт её золотая рамка).
 *
 * Выходы: SVG (HTML и печать из браузера), PNG / data URL (диалоги,
 * сертификат PDF, Word), вектор jsPDF — плитка с рамкой (`drawBrandQrTilePdf`:
 * страница журнала без шапки, бумажный бланк) и плитка в ячейке шапки
 * журнала (`drawBrandQrCellPdf`: рамка — сами линии ячейки). Геометрия одна —
 * `brandQrLayout`. Адрес внутри кода помощник не меняет.
 *
 * Server-only: `qrcode`, `node:fs`, `@napi-rs/canvas`. Клиенту — пропорции
 * из `@/lib/brand-qr-shared`.
 */

export type BrandQrOptions = {
  /** Рамка и полоса «Отсканировать» снизу. По умолчанию — есть. */
  caption?: boolean;
};

export const BRAND_QR_CAPTION_TITLE = "Отсканировать";
/** Модули, «глаза», рамка, полоса и знак — чистый чёрный: ч/б принтер печатает его сплошным тонером. */
export const BRAND_QR_INK = "#000000";
const PAPER = "#ffffff";

/** Тихая зона вокруг матрицы (белое окно внутри рамки), модулей. */
export const BRAND_QR_QUIET = 2;
/** Подложка знака — не больше этой доли стороны матрицы. */
const LOGO_MAX_SHARE = 0.2;
const PAD_RADIUS = 0.3;
const MARK_INSET = 0.09;
/** Скругление внешних углов блока, доля ширины плитки (как у прежней плашки). */
const BLOCK_RADIUS = 0.045;
/** Поле слова в полосе слева и справа, доля ширины плитки: слово — максимально крупно по ширине. */
const TITLE_SIDE = 0.06;
/**
 * Ширина слова в em у DejaVu Sans Bold — самого широкого из шрифтов, которыми
 * оно рисуется (PNG и PDF — DejaVu Sans Bold, SVG — системный шрифт браузера):
 * по ней кегль подбирается так, чтобы слово точно влезло в полосу.
 */
const TITLE_EM = 8.69;
const CAPS_ASCENT = 0.75;
const DESCENT = 0.21;

const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf-fonts");
const BOLD_FONT_FILE = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");
const FONT_BOLD = "WeSetupQrBold";

export type BrandQrBox = { x: number; y: number; w: number; h: number; r: number };
export type BrandQrText = { text: string; x: number; y: number; size: number };

/** Фигура знака в квадрате [0, 1]²: скруглённый прямоугольник или круг, чёрный (`ink`) или белый. */
type MarkShape =
  | { kind: "rect"; x: number; y: number; w: number; h: number; r: number; ink: boolean }
  | { kind: "circle"; cx: number; cy: number; r: number; ink: boolean };

/**
 * Знак сайта, плоский ч/б: чёрная обложка блокнота; три кольца слева —
 * чёрная скоба в белом зазоре (видна и на обложке, и за её краем); белая
 * «C» с прорезью справа. Фигуры рисуются по порядку, белые вырезают из
 * чёрных. Самые тонкие детали — ~5 % знака: на 3–4 мм это 0,15–0,2 мм,
 * лазерный принтер печатает их уверенно.
 */
const MARK_SHAPES: readonly MarkShape[] = [
  { kind: "rect", x: 0.28, y: 0.06, w: 0.62, h: 0.88, r: 0.12, ink: true },
  ...[0.26, 0.5, 0.74].flatMap((cy): MarkShape[] => [
    { kind: "rect", x: 0.11, y: cy - 0.09, w: 0.33, h: 0.18, r: 0.09, ink: false },
    { kind: "rect", x: 0.14, y: cy - 0.0425, w: 0.26, h: 0.085, r: 0.0425, ink: true },
  ]),
  { kind: "circle", cx: 0.665, cy: 0.5, r: 0.18, ink: false },
  { kind: "circle", cx: 0.665, cy: 0.5, r: 0.095, ink: true },
  { kind: "rect", x: 0.665, y: 0.44, w: 0.19, h: 0.12, r: 0, ink: true },
];

/** Раскладка плитки; единица — модуль, начало — левый верхний угол плитки. */
export type BrandQrLayout = {
  url: string;
  errorCorrection: "H";
  version: number;
  /** Сторона матрицы, модулей. */
  size: number;
  /** Тихая зона вокруг матрицы внутри окна, модулей. */
  quiet: number;
  /** Рамка слева, сверху и справа, модулей (без полосы — 0). */
  frame: number;
  /** Плитка: ширина — окно + 2 рамки; высота — рамка + окно + полоса (без полосы — окно). */
  width: number;
  height: number;
  /**
   * Окно — белый квадрат с матрицей и тихой зоной (сторона `size + 2·quiet`):
   * модуль (row, col) — в (x + quiet + col, y + quiet + row).
   */
  window: BrandQrBox;
  /** Чёрный блок — вся плитка, скругление углов `r`; без полосы — null. */
  block: BrandQrBox | null;
  /** Полоса под окном (утолщение рамки снизу), в ней слово; без полосы — null. */
  strip: BrandQrBox | null;
  /** Модуль тёмный по стандарту (до выреза под знак). */
  dark: (row: number, col: number) => boolean;
  /** Модуль рисуется: тёмный и центр не под подложкой знака. */
  plain: (row: number, col: number) => boolean;
  /** Белая подложка знака и квадрат знака — в координатах плитки. */
  pad: BrandQrBox;
  mark: BrandQrBox;
  title: BrandQrText | null;
};

/** Матрица QR — коррекция H (под знаком по центру вырезаны модули). */
export function brandQrMatrix(url: string): QRCode.QRCode {
  return QRCode.create(url, { errorCorrectionLevel: "H" });
}

/** Сторона подложки знака, модулей: нечётная (ровно по центру матрицы), ≤ 20 %. */
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
  const qr = brandQrMatrix(url);
  const size = qr.modules.size;
  const data = qr.modules.data;
  const quiet = BRAND_QR_QUIET;
  const side = size + 2 * quiet;
  const withCaption = options.caption !== false;
  // С полосой: окно — (1 − 2·рамка) ширины плитки, высота — по общей пропорции.
  const width = withCaption ? side / (1 - 2 * BRAND_QR_FRAME) : side;
  const frame = withCaption ? width * BRAND_QR_FRAME : 0;
  const height = withCaption ? width * BRAND_QR_CAPTION_ASPECT : side;
  const radius = withCaption ? width * BLOCK_RADIUS : 0;
  const codeWindow: BrandQrBox = { x: frame, y: frame, w: side, h: side, r: Math.max(0, radius - frame) };
  const dark = (row: number, col: number) => data[row * size + col] === 1;

  const k = brandQrPadModules(size);
  const start = (size - k) / 2;
  const padRadius = k * PAD_RADIUS;
  const underPad = (row: number, col: number) => insideRounded(col + 0.5, row + 0.5, start, start, k, padRadius);
  const pad: BrandQrBox = { x: codeWindow.x + quiet + start, y: codeWindow.y + quiet + start, w: k, h: k, r: padRadius };
  const inset = k * MARK_INSET;
  const mark: BrandQrBox = { x: pad.x + inset, y: pad.y + inset, w: k - 2 * inset, h: k - 2 * inset, r: 0 };

  let block: BrandQrBox | null = null;
  let strip: BrandQrBox | null = null;
  let title: BrandQrText | null = null;
  if (withCaption) {
    block = { x: 0, y: 0, w: width, h: height, r: radius };
    const stripY = frame + side;
    strip = { x: 0, y: stripY, w: width, h: height - stripY, r: 0 };
    // Кегль — по ширине (поля `TITLE_SIDE`); строка «заглавная — хвост „р“» по центру полосы.
    const titleSize = Math.min((width * (1 - 2 * TITLE_SIDE)) / TITLE_EM, strip.h / (CAPS_ASCENT + DESCENT + 0.5));
    const baseline = stripY + (strip.h - (CAPS_ASCENT + DESCENT) * titleSize) / 2 + CAPS_ASCENT * titleSize;
    title = { text: BRAND_QR_CAPTION_TITLE, x: width / 2, y: baseline, size: titleSize };
  }

  return {
    url,
    errorCorrection: "H",
    version: qr.version,
    size,
    quiet,
    frame,
    width,
    height,
    window: codeWindow,
    block,
    strip,
    dark,
    plain: (row, col) => dark(row, col) && !underPad(row, col),
    pad,
    mark,
    title,
  };
}

// ---------------------------------------------------------------------------
// Общее: модули, подложка и знак — через «кисть» вывода
// ---------------------------------------------------------------------------

type Painter = {
  box(x: number, y: number, w: number, h: number, r: number, ink: boolean): void;
  circle(cx: number, cy: number, r: number, ink: boolean): void;
};

/** Подряд идущие рисуемые модули строки: [начало, длина]. */
function moduleRuns(layout: BrandQrLayout, row: number): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let col = 0;
  while (col < layout.size) {
    if (!layout.plain(row, col)) {
      col += 1;
      continue;
    }
    const start = col;
    while (col < layout.size && layout.plain(row, col)) col += 1;
    runs.push([start, col - start]);
  }
  return runs;
}

/**
 * Подложка и знак. (ox, oy) — левый верхний угол окна на выходе, u — модуль:
 * координаты раскладки берутся от угла окна, поэтому одинаково работают и в
 * плитке с рамкой, и в ячейке шапки.
 */
function paintMark(p: Painter, layout: BrandQrLayout, ox: number, oy: number, u: number) {
  const at = (box: BrandQrBox) => ({ x: ox + (box.x - layout.window.x) * u, y: oy + (box.y - layout.window.y) * u });
  const pad = at(layout.pad);
  p.box(pad.x, pad.y, layout.pad.w * u, layout.pad.h * u, layout.pad.r * u, false);
  const mark = at(layout.mark);
  const s = layout.mark.w * u;
  for (const shape of MARK_SHAPES) {
    if (shape.kind === "rect") p.box(mark.x + shape.x * s, mark.y + shape.y * s, shape.w * s, shape.h * s, shape.r * s, shape.ink);
    else p.circle(mark.x + shape.cx * s, mark.y + shape.cy * s, shape.r * s, shape.ink);
  }
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

const num = (value: number) => String(Math.round(value * 1000) / 1000);

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Тёмные модули — строками штриха толщиной в модуль, как у библиотеки qrcode (компактно). */
function modulesPath(layout: BrandQrLayout): string {
  let d = "";
  for (let row = 0; row < layout.size; row += 1) {
    let pen: number | null = null;
    for (const [start, length] of moduleRuns(layout, row)) {
      const x = layout.window.x + layout.quiet + start;
      d += pen === null ? `M${num(x)} ${num(layout.window.y + layout.quiet + row + 0.5)}` : `m${num(x - pen)} 0`;
      d += `h${length}`;
      pen = x + length;
    }
  }
  return d;
}

function svgPainter(parts: string[]): Painter {
  const fill = (ink: boolean) => (ink ? BRAND_QR_INK : PAPER);
  return {
    box(x, y, w, h, r, ink) {
      const rx = r > 0 ? ` rx="${num(r)}"` : "";
      parts.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${rx} fill="${fill(ink)}"/>`);
    },
    circle(cx, cy, r, ink) {
      parts.push(`<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="${fill(ink)}"/>`);
    },
  };
}

/**
 * SVG плитки. `width`/`height` — в px (как у прежних SVG библиотеки
 * qrcode); на странице размер задаёт CSS, на печати — мм (`viewBox`
 * сохраняет пропорции плитки). Только чёрный и белый, без картинок и `id`.
 */
export async function brandQrSvg(url: string, options: BrandQrOptions = {}): Promise<string> {
  return renderBrandQrSvg(brandQrLayout(url, options));
}

function renderBrandQrSvg(layout: BrandQrLayout): string {
  const pxWidth = 600;
  const pxHeight = Math.round((pxWidth * layout.height) / layout.width);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pxWidth}" height="${pxHeight}" viewBox="0 0 ${num(layout.width)} ${num(layout.height)}" role="img" aria-label="QR-код WeSetup">`,
  ];
  const painter = svgPainter(parts);
  if (layout.block) {
    const b = layout.block;
    painter.box(b.x, b.y, b.w, b.h, b.r, true);
    const w = layout.window;
    painter.box(w.x, w.y, w.w, w.h, w.r, false);
  } else {
    parts.push(`<rect width="${num(layout.width)}" height="${num(layout.height)}" fill="${PAPER}"/>`);
  }
  parts.push(`<path fill="none" stroke="${BRAND_QR_INK}" stroke-width="1" shape-rendering="crispEdges" d="${modulesPath(layout)}"/>`);
  paintMark(painter, layout, layout.window.x, layout.window.y, 1);
  if (layout.title) {
    const t = layout.title;
    parts.push(
      `<text x="${num(t.x)}" y="${num(t.y)}" font-size="${num(t.size)}" font-weight="700" font-family="'Segoe UI','Helvetica Neue',Arial,'DejaVu Sans',sans-serif" fill="${PAPER}" text-anchor="middle">${escapeXml(t.text)}</text>`
    );
  }
  parts.push("</svg>");
  return parts.join("");
}

// ---------------------------------------------------------------------------
// PNG (@napi-rs/canvas)
// ---------------------------------------------------------------------------

type CanvasModule = typeof import("@napi-rs/canvas");
type Ctx = ReturnType<ReturnType<CanvasModule["createCanvas"]>["getContext"]>;

let fontsReady = false;

/** DejaVu Sans Bold из репозитория — одинаковый шрифт на Windows и на сервере. */
function ensureFonts(canvas: CanvasModule): string {
  if (!fontsReady) {
    fontsReady = true;
    if (fs.existsSync(BOLD_FONT_FILE)) canvas.GlobalFonts.registerFromPath(BOLD_FONT_FILE, FONT_BOLD);
  }
  return canvas.GlobalFonts.has(FONT_BOLD) ? FONT_BOLD : "sans-serif";
}

function canvasPainter(ctx: Ctx): Painter {
  return {
    box(x, y, w, h, r, ink) {
      ctx.fillStyle = ink ? BRAND_QR_INK : PAPER;
      ctx.beginPath();
      if (r > 0) ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
      else ctx.rect(x, y, w, h);
      ctx.fill();
    },
    circle(cx, cy, r, ink) {
      ctx.fillStyle = ink ? BRAND_QR_INK : PAPER;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    },
  };
}

/**
 * PNG плитки. `width` — желаемая ширина, px: модуль — целое число пикселей
 * (чёткие края), рамка — целое число пикселей (≥ 1), поэтому итог не уже
 * `width` (с точностью до пикселя рамки), а пропорция — `brandQrLayout` с
 * точностью до пикселя.
 */
export async function brandQrPng(url: string, options: BrandQrOptions & { width?: number } = {}): Promise<Buffer> {
  const layout = brandQrLayout(url, options);
  const canvasModule = await import("@napi-rs/canvas");
  const scale = Math.max(1, Math.ceil((options.width ?? 600) / layout.width));
  const side = layout.window.w * scale;
  const frame = layout.block ? Math.max(1, Math.round(layout.frame * scale)) : 0;
  const stripHeight = layout.strip ? Math.round(layout.strip.h * scale) : 0;
  const w = side + 2 * frame;
  const h = frame + side + stripHeight;
  const canvas = canvasModule.createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const painter = canvasPainter(ctx);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  if (layout.block) {
    const radius = (layout.block.r / layout.width) * w;
    painter.box(0, 0, w, h, radius, true);
    painter.box(frame, frame, side, side, Math.max(0, radius - frame), false);
  }
  ctx.fillStyle = BRAND_QR_INK;
  for (let row = 0; row < layout.size; row += 1) {
    for (const [start, length] of moduleRuns(layout, row)) {
      ctx.fillRect(frame + (layout.quiet + start) * scale, frame + (layout.quiet + row) * scale, length * scale, scale);
    }
  }
  paintMark(painter, layout, frame, frame, scale);

  if (layout.title && layout.strip) {
    const t = layout.title;
    const family = ensureFonts(canvasModule);
    const maxWidth = w * (1 - 2 * TITLE_SIDE);
    let px = t.size * scale;
    ctx.font = `${px}px ${family}`;
    const measured = ctx.measureText(t.text).width;
    if (measured > maxWidth) {
      px *= maxWidth / measured;
      ctx.font = `${px}px ${family}`;
    }
    ctx.fillStyle = PAPER;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(t.text, w / 2, frame + side + (t.y - layout.strip.y) * scale);
  }
  return canvas.toBuffer("image/png");
}

export async function brandQrPngDataUrl(url: string, options: BrandQrOptions & { width?: number } = {}): Promise<string> {
  return `data:image/png;base64,${(await brandQrPng(url, options)).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// jsPDF (вектор)
// ---------------------------------------------------------------------------

export type BrandQrPdfBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  module: number;
  /** Окно кода на странице (квадрат матрицы с тихой зоной), мм. */
  window: { x0: number; y0: number; x1: number; y1: number };
};

/**
 * Плитка рисуется внутри `q … Q` (`saveGraphicsState`): после неё графическое
 * состояние листа (цвет заливки и прочее) прежнее — его возвращает сам `Q`,
 * без повторного оператора цвета, поэтому в потоке плитки только чёрный и
 * белый. Шрифт, кегль и цвет текста jsPDF восстанавливает сам; цвет заливки в
 * его учёте (`getFillColor`) после плитки — последний цвет плитки (штамп QR —
 * последнее, что рисуется на листе).
 */
function withPdfState<T>(doc: jsPDF, draw: () => T): T {
  doc.saveGraphicsState();
  try {
    return draw();
  } finally {
    doc.restoreGraphicsState();
  }
}

/** Цвета — только серые операторы PDF (`g`): чёрный 0, белый 1 (никаких `rg`/`k`). */
function pdfPainter(doc: jsPDF): Painter {
  const color = (ink: boolean) => {
    const c = ink ? 0 : 255;
    doc.setFillColor(c, c, c);
  };
  return {
    box(x, y, w, h, r, ink) {
      color(ink);
      if (r > 0) {
        const radius = Math.min(r, w / 2, h / 2);
        doc.roundedRect(x, y, w, h, radius, radius, "F");
      } else doc.rect(x, y, w, h, "F");
    },
    circle(cx, cy, r, ink) {
      color(ink);
      doc.circle(cx, cy, r, "F");
    },
  };
}

function pdfModules(doc: jsPDF, layout: BrandQrLayout, ox: number, oy: number, u: number) {
  doc.setFillColor(0, 0, 0);
  for (let row = 0; row < layout.size; row += 1) {
    for (const [start, length] of moduleRuns(layout, row)) {
      // +0,01 мм — без «волосяных» щелей между соседними строками.
      doc.rect(ox + (layout.quiet + start) * u, oy + (layout.quiet + row) * u, length * u, u + 0.01, "F");
    }
  }
}

let boldFontBase64: string | null | undefined;

/**
 * Жирный шрифт слова в PDF — всегда свой DejaVu Sans Bold из репозитория, как
 * у PNG: плитка одинакова во всех выходах, какой бы шрифт ни был у документа
 * (у печатных журналов с 2026-09-28 — Liberation Serif, у слова в полосе он
 * не нужен: кегль подобран по ширине DejaVu Sans Bold, `TITLE_EM`). jsPDF
 * встраивает только использованные буквы — это несколько килобайт.
 * `fontName` — запасной, если файла нет.
 */
function pdfBoldFont(doc: jsPDF, fontName: string): string {
  const fonts = doc.getFontList();
  if (Object.prototype.hasOwnProperty.call(fonts, FONT_BOLD)) return FONT_BOLD;
  if (boldFontBase64 === undefined) {
    boldFontBase64 = fs.existsSync(BOLD_FONT_FILE) ? fs.readFileSync(BOLD_FONT_FILE).toString("base64") : null;
  }
  if (!boldFontBase64) return fontName;
  doc.addFileToVFS("wesetup-qr-bold.ttf", boldFontBase64);
  doc.addFont("wesetup-qr-bold.ttf", FONT_BOLD, "bold");
  return FONT_BOLD;
}

/** Слово «Отсканировать» белым жирным: центр `cx`, базовая линия `baseline`, кегль — мм (подгонка по `maxWidth`). */
function pdfTitle(doc: jsPDF, fontName: string, text: string, cx: number, baseline: number, sizeMm: number, maxWidth: number) {
  doc.setTextColor(255, 255, 255);
  doc.setFont(pdfBoldFont(doc, fontName), "bold");
  const size = (sizeMm * 72) / 25.4;
  doc.setFontSize(size);
  const textWidth = doc.getTextWidth(text);
  if (textWidth > maxWidth) doc.setFontSize((size * maxWidth) / textWidth);
  doc.text(text, cx, baseline, { align: "center", baseline: "alphabetic" });
}

/**
 * Плитка с рамкой векторно в jsPDF — QR на странице журнала без шапки и в
 * бумажном бланке. Та же плитка, что у PNG и SVG (`brandQrLayout` с полосой):
 * чёрный скруглённый блок, белое окно, чёрные квадратные модули и «глаза»,
 * знак, белое «Отсканировать» в полосе. (x, y) — левый верхний угол плитки,
 * `width` — её ширина с рамкой, мм; высота — по пропорции плитки.
 * `fontName` — шрифт документа с кириллицей (слово — его жирным, см. `pdfBoldFont`).
 */
export function drawBrandQrTilePdf(
  doc: jsPDF,
  layout: BrandQrLayout,
  x: number,
  y: number,
  width: number,
  options: { fontName: string },
): BrandQrPdfBox {
  const { block, strip, title } = layout;
  if (!block || !strip || !title) throw new Error("Плитка PDF — только QR с полосой");
  const u = width / layout.width;
  const height = layout.height * u;
  const w = layout.window;
  const ox = x + w.x * u;
  const oy = y + w.y * u;
  withPdfState(doc, () => {
    const painter = pdfPainter(doc);
    painter.box(x, y, width, height, block.r * u, true);
    painter.box(ox, oy, w.w * u, w.h * u, w.r * u, false);
    pdfModules(doc, layout, ox, oy, u);
    paintMark(painter, layout, ox, oy, u);
    pdfTitle(doc, options.fontName, title.text, x + title.x * u, y + title.y * u, title.size * u, width * (1 - 2 * TITLE_SIDE));
  });
  return { x, y, width, height, module: u, window: { x0: ox, y0: oy, x1: ox + w.w * u, y1: oy + w.h * u } };
}

/** Высота плитки в ячейке шапки без запаса, модулей: окно + полоса (рамки нет — её дают линии ячейки). */
export function brandQrCellHeight(layout: BrandQrLayout): number {
  if (!layout.strip) throw new Error("Плитка в ячейке — только QR с полосой");
  return layout.window.h + layout.strip.h;
}

/**
 * Плитка в ячейке шапки печатного журнала: рамку кода дают сами линии ячейки
 * (0,2 мм — тонкая рамка), плитка заполняет ячейку внутри линий: сверху белое
 * окно с кодом (по ширине — ровно окно раскладки, по высоте — код по центру),
 * снизу во всю ширину ячейки — чёрная полоса с «Отсканировать» (та же, что у
 * плитки с рамкой: высота и кегль — от раскладки). Углы прямые — это ячейка
 * таблицы. `box` — ячейка внутри линий, мм: ширина = сторона окна × модуль.
 */
export function drawBrandQrCellPdf(
  doc: jsPDF,
  layout: BrandQrLayout,
  box: { x0: number; y0: number; x1: number; y1: number },
  options: { fontName: string },
): BrandQrPdfBox {
  const { strip, title } = layout;
  if (!strip || !title) throw new Error("Плитка в ячейке — только QR с полосой");
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const u = width / layout.window.w;
  const stripHeight = strip.h * u;
  const windowHeight = height - stripHeight;
  const side = layout.window.w * u;
  const ox = box.x0;
  const oy = box.y0 + (windowHeight - side) / 2;
  withPdfState(doc, () => {
    const painter = pdfPainter(doc);
    // Белый фон окна (перекрывает, если бланк что-то уже нарисовал) и полоса.
    painter.box(box.x0, box.y0, width, windowHeight, 0, false);
    painter.box(box.x0, box.y1 - stripHeight, width, stripHeight, 0, true);
    pdfModules(doc, layout, ox, oy, u);
    paintMark(painter, layout, ox, oy, u);
    const baseline = box.y1 - stripHeight + (title.y - strip.y) * u;
    pdfTitle(doc, options.fontName, title.text, box.x0 + width / 2, baseline, title.size * u, layout.width * (1 - 2 * TITLE_SIDE) * u);
  });
  return { x: box.x0, y: box.y0, width, height, module: u, window: { x0: ox, y0: oy, x1: ox + side, y1: oy + side } };
}
