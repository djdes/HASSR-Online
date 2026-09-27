import type { jsPDF } from "jspdf";
import type { QRCode } from "qrcode";

import {
  BRAND_QR_QUIET,
  brandQrCellHeight,
  brandQrLayout,
  brandQrMatrix,
  drawBrandQrCellPdf,
  drawBrandQrTilePdf,
  type BrandQrLayout,
} from "@/lib/brand-qr";
import { JOURNAL_SHEET_MARGIN_MM } from "@/lib/pdf-journal-sheet";
import { JOURNAL_LINE_WIDTH } from "@/lib/pdf-journal-table";

/**
 * QR печатного журнала — в шапке ХАССП справа, фирменный (2026-09-27).
 *
 * Настоящий документ ведёт на основной QR журнала организации (запись с
 * телефона по PIN), образец бланка — на страницу журнала на сайте,
 * скачанный шаблон — на /qb.
 *
 * QR не занимает строк таблицы — он встроен в шапку:
 *   1. `prepareJournalQr` до отрисовки бланка считает плитку под адрес;
 *   2. шапка ХАССП (`drawJournalHeader` в document-pdf) оставляет справа
 *      от колонки «Начат / Окончен · СТР. X ИЗ N» ячейку под плитку на
 *      высоту строк организации и названия и регистрирует её
 *      (`registerJournalQrSlot`) — на первой странице и на каждом повторе;
 *   3. `stampJournalQr` (последним) рисует плитку в каждой такой ячейке.
 *      На странице без шапки — в правом верхнем углу, вровень с правым
 *      краем содержимого, если там пусто (`trackPdfInk` записал всё, что
 *      нарисовал бланк); занято — на этой странице QR нет.
 * Нижнего резерва под QR больше нет: таблицы доходят до нижнего поля
 * листа (плюс полоса под «СТР. X ИЗ N», как у всех бланков).
 *
 * Вид — фирменный ч/б QR (`brand-qr.ts`): коррекция H, знак сайта по
 * центру, чёрные квадратные модули и «глаза», снизу чёрная полоса с одним
 * словом «Отсканировать», всё векторное. В ячейке шапки рамку кода дают сами
 * линии ячейки (0,2 мм), плитка заполняет ячейку: окно с кодом (тихая зона
 * 2 модуля) и полоса снизу во всю ширину ячейки (`drawBrandQrCellPdf`). На
 * странице без шапки — отдельная плитка с тонкой рамкой (`drawBrandQrTilePdf`).
 *
 * Размер — под шапку, и шапка не больше, чем с прежней плиткой (плашка с
 * градиентом, до 2026-09-27): ширина ячейки — окно кода под модуль
 * `JOURNAL_QR_TARGET_MODULE_MM`, но не уже `JOURNAL_QR_CELL_BASE_WIDTH_MM`
 * (с ней две строки шапки по 10 мм не растут) и не шире
 * `JOURNAL_QR_CELL_MAX_WIDTH_MM`; высота — окно + полоса. Модуль не меньше
 * `JOURNAL_QR_MIN_MODULE_MM`. Адрес плотнее (`JOURNAL_QR_MAX_MODULES`) —
 * ошибка: его нужно укоротить, а не печатать нечитаемый код.
 */

/** Высота строк шапки ХАССП без переносов (две строки по 10 мм). */
export const JOURNAL_HEADER_ROWS_MM = 20;
/** Минимальный модуль QR на бумаге, мм. */
export const JOURNAL_QR_MIN_MODULE_MM = 0.35;
/**
 * Модуль, до которого ячейка растёт, если в базовой ширине он мельче, мм. При
 * 0,35 мм «снимок телефоном» (300 dpi, поворот, перспектива, размытие, JPEG)
 * jsQR изредка не читает, при 0,365 мм — читает (опыт `.agent/tasks/
 * journal-qr-header-2026-09`, raw/target-module-experiment.txt); zxing-cpp
 * читает оба. Короткие адреса (≤ 41 модуля) и так крупнее — шапка не растёт.
 */
export const JOURNAL_QR_TARGET_MODULE_MM = 0.365;
/** На сколько строкам шапки можно вырасти ради QR, мм (фактически — до 3,6 мм у 53 модулей). */
export const JOURNAL_QR_MAX_GROWTH_MM = 4;
/**
 * Ширина ячейки QR, при которой шапка не растёт (между осями линий), мм — как
 * у прежней плитки: средняя колонка с названием журнала не уже, чем была.
 */
export const JOURNAL_QR_CELL_BASE_WIDTH_MM = 16.9;
/** Самая широкая ячейка QR, мм — как у прежней плитки самого плотного адреса. */
export const JOURNAL_QR_CELL_MAX_WIDTH_MM = 20.3;
/**
 * Зона непечати принтера у края листа, мм (≥ 4 мм): что заходит за неё,
 * считается вылезшим за лист, — по нему QR не равняется.
 */
export const JOURNAL_QR_EDGE_MM = 5;
/** Свободное поле вокруг плитки на странице без шапки, мм. */
export const JOURNAL_QR_PAD_MM = 1.3;

/** Окно кода в ячейке — ширина ячейки без линий (по половине линии с каждой стороны), мм. */
const WINDOW_BASE_MM = JOURNAL_QR_CELL_BASE_WIDTH_MM - JOURNAL_LINE_WIDTH;
const WINDOW_MAX_MM = JOURNAL_QR_CELL_MAX_WIDTH_MM - JOURNAL_LINE_WIDTH;

/**
 * Самая плотная матрица, что помещается в шапку с модулем не меньше
 * `JOURNAL_QR_MIN_MODULE_MM` (сторона QR растёт шагами по 4 модуля):
 * 53 модуля, версия 9 — самый длинный адрес документа /qj/… и шаблона /qb.
 */
export const JOURNAL_QR_MAX_MODULES = (() => {
  let modules = 21;
  while ((modules + 4 + 2 * BRAND_QR_QUIET) * JOURNAL_QR_MIN_MODULE_MM <= WINDOW_MAX_MM + 1e-9) modules += 4;
  return modules;
})();

export type JournalPdfQr = {
  /** Адрес, который кодирует QR. */
  url: string;
  /**
   * Строка мелким серым шрифтом внизу КАЖДОЙ страницы, от левого поля, —
   * копирайт скачанного шаблона. Нет — строки нет: подпись самого QR —
   * «Отсканировать» в его полосе.
   */
  footer?: string | null;
  /**
   * Только для автопроверки «ничего не перекрыто»: ячейка под QR
   * оставляется и место считается как обычно, но плитка и строка внизу не
   * рисуются — растр такой страницы показывает, что было на месте QR.
   */
  probeOnly?: boolean;
};

export type PdfBox = { x0: number; y0: number; x1: number; y1: number };

/** Плитка QR документа: фирменная раскладка и её размер на бумаге. */
export type JournalQrTile = {
  layout: BrandQrLayout;
  /** Сторона матрицы, модулей. */
  modules: number;
  /** Сторона модуля, мм. */
  module: number;
  /** Плитка с рамкой (страница без шапки, бумажный бланк), мм. */
  width: number;
  height: number;
  /** Ячейка шапки между осями её линий, мм: ширина — окно кода + линия; высота — окно + полоса + линия. */
  cellWidth: number;
  cellHeight: number;
};

export type JournalQrPlacement = {
  page: number;
  /**
   * `header` — в ячейке шапки; `corner` — страница без шапки, правый
   * верхний угол был свободен; `none` — шапки нет и угол занят: на этой
   * странице QR нет.
   */
  where: "header" | "corner" | "none";
  /** Плитка на странице, мм (в шапке — ячейка внутри линий); `null` — QR нет. */
  box: PdfBox | null;
  /** Окно кода на странице — квадрат матрицы с тихой зоной, мм; `null` — QR нет. */
  window: PdfBox | null;
  /** Ячейка шапки, в которой стоит плитка (только `header`). */
  slot: PdfBox | null;
  modules: number;
  module: number;
};

/**
 * Плитка под адрес: окно кода — под модуль `JOURNAL_QR_TARGET_MODULE_MM`, но
 * не уже базовой ячейки (шапка не растёт) и не шире самой широкой (у самого
 * плотного адреса модуль тогда 0,353 мм — не меньше 0,35).
 */
export function journalQrTile(url: string): JournalQrTile {
  const layout = brandQrLayout(url);
  const side = layout.window.w;
  if (side * JOURNAL_QR_MIN_MODULE_MM > WINDOW_MAX_MM + 1e-9) {
    throw new Error(
      `QR слишком плотный для шапки: ${layout.size} модулей (не больше ${JOURNAL_QR_MAX_MODULES}) — адрес нужно укоротить`,
    );
  }
  const windowMm = Math.min(Math.max(WINDOW_BASE_MM, side * JOURNAL_QR_TARGET_MODULE_MM), WINDOW_MAX_MM);
  const module = windowMm / side;
  return {
    layout,
    modules: layout.size,
    module,
    width: layout.width * module,
    height: layout.height * module,
    cellWidth: windowMm + JOURNAL_LINE_WIDTH,
    cellHeight: brandQrCellHeight(layout) * module + JOURNAL_LINE_WIDTH,
  };
}

/** Ширина ячейки QR в шапке (между осями линий), мм. */
export function journalQrCellWidth(tile: JournalQrTile): number {
  return tile.cellWidth;
}

/**
 * Высота строк шапки, которая нужна ячейке QR, мм. Меньше
 * `JOURNAL_HEADER_ROWS_MM` — строки шапки не растут, плитка заполняет их
 * высоту (код — по центру окна).
 */
export function journalQrCellHeight(tile: JournalQrTile): number {
  return tile.cellHeight;
}

/** Матрица QR печатного журнала — фирменный QR (коррекция H). */
export function journalQrMatrix(url: string): QRCode {
  return brandQrMatrix(url);
}

// ---------------------------------------------------------------------------
// Состояние документа: плитка и ячейки шапки по страницам.
// ---------------------------------------------------------------------------

type DocQr = { tile: JournalQrTile; slots: Map<number, PdfBox> };
const docQr = new WeakMap<jsPDF, DocQr>();

function pageNumberOf(doc: jsPDF): number {
  return (doc as jsPDF & { getCurrentPageInfo: () => { pageNumber: number } }).getCurrentPageInfo().pageNumber;
}

/**
 * QR этого документа: плитка под адрес. Вызывать до отрисовки бланка —
 * шапка по ней оставит ячейку. Без вызова шапка печатается без QR.
 */
export function prepareJournalQr(doc: jsPDF, url: string): JournalQrTile {
  const tile = journalQrTile(url);
  docQr.set(doc, { tile, slots: new Map() });
  return tile;
}

/** Плитка QR документа (`prepareJournalQr`) или `null` — документ без QR. */
export function journalQrTileOf(doc: jsPDF): JournalQrTile | null {
  return docQr.get(doc)?.tile ?? null;
}

/** Ячейка шапки под QR на текущей странице (рамка ячейки, мм). */
export function registerJournalQrSlot(doc: jsPDF, cell: PdfBox) {
  const state = docQr.get(doc);
  if (!state) return;
  const page = pageNumberOf(doc);
  if (!state.slots.has(page)) state.slots.set(page, cell);
}

// ---------------------------------------------------------------------------
// Учёт «чернил»: что бланк нарисовал на каждой странице.
// ---------------------------------------------------------------------------

export type PdfInkTracker = {
  boxes(page: number): PdfBox[];
  /** Вернуть методы документа как были (штамп QR уже не учитывается). */
  stop(): void;
};

type AnyFn = (...args: unknown[]) => unknown;

function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFillStyle(style: unknown): boolean {
  return typeof style === "string" && /[fFbB]/.test(style);
}

export function trackPdfInk(doc: jsPDF): PdfInkTracker {
  const byPage = new Map<number, PdfBox[]>();
  const target = doc as unknown as Record<string, AnyFn>;
  const originals = new Map<string, AnyFn>();
  const k = doc.internal.scaleFactor;

  const add = (x0: number, y0: number, x1: number, y1: number) => {
    if (![x0, y0, x1, y1].every(isNum)) return;
    const page = pageNumberOf(doc);
    const list = byPage.get(page) ?? [];
    list.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) });
    byPage.set(page, list);
  };
  const halfLine = () => {
    const width = (doc as jsPDF & { getLineWidth?: () => number }).getLineWidth?.() ?? 0.2;
    return Math.max(width, 0.1) / 2;
  };
  const addStroke = (x0: number, y0: number, x1: number, y1: number) => {
    const h = halfLine();
    add(Math.min(x0, x1) - h, Math.min(y0, y1) - h, Math.max(x0, x1) + h, Math.max(y0, y1) + h);
  };
  const addShape = (x: number, y: number, w: number, h: number, style: unknown) => {
    if (style === null) return; // путь для обрезки — ничего не рисует
    if (isFillStyle(style)) {
      add(x, y, x + w, y + h);
      return;
    }
    // Контур: большая рамка вокруг листа не должна «занимать» всё внутри.
    addStroke(x, y, x + w, y);
    addStroke(x, y + h, x + w, y + h);
    addStroke(x, y, x, y + h);
    addStroke(x + w, y, x + w, y + h);
  };

  const recorders: Record<string, (args: unknown[]) => void> = {
    rect: ([x, y, w, h, style]) => isNum(x) && isNum(y) && isNum(w) && isNum(h) && addShape(x, y, w, h, style),
    roundedRect: ([x, y, w, h, , , style]) =>
      isNum(x) && isNum(y) && isNum(w) && isNum(h) && addShape(x, y, w, h, style),
    line: ([x1, y1, x2, y2]) => isNum(x1) && isNum(y1) && isNum(x2) && isNum(y2) && addStroke(x1, y1, x2, y2),
    circle: ([x, y, r]) => isNum(x) && isNum(y) && isNum(r) && add(x - r, y - r, x + r, y + r),
    ellipse: ([x, y, rx, ry]) => isNum(x) && isNum(y) && isNum(rx) && isNum(ry) && add(x - rx, y - ry, x + rx, y + ry),
    triangle: ([x1, y1, x2, y2, x3, y3]) => {
      if (![x1, y1, x2, y2, x3, y3].every(isNum)) return;
      const xs = [x1, x2, x3] as number[];
      const ys = [y1, y2, y3] as number[];
      add(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    },
    lines: ([segments, x, y, scale]) => {
      if (!Array.isArray(segments) || !isNum(x) || !isNum(y)) return;
      const [sx, sy] = Array.isArray(scale) && isNum(scale[0]) && isNum(scale[1]) ? scale : [1, 1];
      let cx = x;
      let cy = y;
      const xs = [cx];
      const ys = [cy];
      for (const seg of segments) {
        if (!Array.isArray(seg) || seg.length < 2) continue;
        // Прямая: [dx, dy]; кривая Безье: [dx1, dy1, dx2, dy2, dx3, dy3].
        for (let i = 0; i + 1 < seg.length; i += 2) {
          if (isNum(seg[i]) && isNum(seg[i + 1])) {
            xs.push(cx + seg[i] * sx);
            ys.push(cy + seg[i + 1] * sy);
          }
        }
        const endX = seg[seg.length - 2];
        const endY = seg[seg.length - 1];
        if (isNum(endX) && isNum(endY)) {
          cx += endX * sx;
          cy += endY * sy;
        }
      }
      const h = halfLine();
      add(Math.min(...xs) - h, Math.min(...ys) - h, Math.max(...xs) + h, Math.max(...ys) + h);
    },
    addImage: (args) => {
      const first = args[0] as Record<string, unknown> | null;
      if (first && typeof first === "object" && isNum(first.x) && isNum(first.y) && isNum(first.width) && isNum(first.height)) {
        add(first.x, first.y, first.x + first.width, first.y + first.height);
        return;
      }
      const offset = isNum(args[1]) ? 1 : 2;
      const [x, y, w, h] = args.slice(offset, offset + 4);
      if (isNum(x) && isNum(y) && isNum(w) && isNum(h)) add(x, y, x + w, y + h);
    },
    text: (args) => {
      let [text, x, y, options] = args as [unknown, unknown, unknown, Record<string, unknown> | undefined];
      if (isNum(text) && isNum(x) && !isNum(y)) {
        // Старая сигнатура text(x, y, text).
        [text, x, y] = [y, text, x];
      }
      if (!isNum(x) || !isNum(y)) return;
      const opts = options && typeof options === "object" ? options : {};
      let lines: string[] = Array.isArray(text)
        ? text.map((line) => String(line))
        : String(text ?? "").split(/\r\n|\r|\n/);
      if (isNum(opts.maxWidth) && opts.maxWidth > 0) {
        lines = lines.flatMap((line) => doc.splitTextToSize(line, opts.maxWidth as number) as string[]);
      }
      if (lines.length === 0 || lines.every((line) => line.trim() === "")) return;
      const fontMm = doc.getFontSize() / k;
      const lineHeightFactor = (doc as jsPDF & { getLineHeightFactor?: () => number }).getLineHeightFactor?.() ?? 1.15;
      const lineStep = isNum(opts.lineHeightFactor) ? fontMm * opts.lineHeightFactor : fontMm * lineHeightFactor;
      const width = Math.max(...lines.map((line) => doc.getTextWidth(line)));
      const align = typeof opts.align === "string" ? opts.align : "left";
      const left = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
      const baseline = typeof opts.baseline === "string" ? opts.baseline : "alphabetic";
      const top =
        baseline === "top" || baseline === "hanging"
          ? y
          : baseline === "middle"
            ? y - fontMm * 0.6
            : baseline === "bottom" || baseline === "ideographic"
              ? y - fontMm * 1.05
              : y - fontMm * 0.85;
      const bottom = top + fontMm * 1.1 + (lines.length - 1) * lineStep;
      const angle = isNum(opts.angle) ? opts.angle : 0;
      if (!angle) {
        add(left, top, left + width, bottom);
        return;
      }
      // Повёрнутый текст (вертикальные заголовки): поворот углов вокруг (x, y).
      const direction = opts.rotationDirection === 0 ? -1 : 1;
      const rad = (direction * angle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const corners = [
        [left, top],
        [left + width, top],
        [left, bottom],
        [left + width, bottom],
      ].map(([px, py]) => {
        const dx = px - x;
        const dy = py - y;
        // Ось Y листа направлена вниз: поворот против часовой — «минус» по Y.
        return [x + dx * cos + dy * sin, y - dx * sin + dy * cos];
      });
      add(
        Math.min(...corners.map((c) => c[0])),
        Math.min(...corners.map((c) => c[1])),
        Math.max(...corners.map((c) => c[0])),
        Math.max(...corners.map((c) => c[1])),
      );
    },
  };

  for (const [name, record] of Object.entries(recorders)) {
    const original = target[name];
    if (typeof original !== "function") continue;
    originals.set(name, original);
    target[name] = function (this: unknown, ...args: unknown[]) {
      try {
        record(args);
      } catch {
        // Учёт не должен ломать печать бланка.
      }
      return original.apply(this, args);
    };
  }

  return {
    boxes: (page) => byPage.get(page) ?? [],
    stop: () => {
      for (const [name, original] of originals) {
        // Методы jsPDF живут в прототипе: удаляем свою обёртку с экземпляра.
        if (Object.getPrototypeOf(doc)[name] === original) delete target[name];
        else target[name] = original;
      }
      originals.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Место на странице без шапки.
// ---------------------------------------------------------------------------

/**
 * Правая граница содержимого страницы, мм от левого края листа: самый
 * правый край нарисованного бланком (таблица, рамка, шапка). По ней QR на
 * странице без шапки встаёт вровень с таблицей — симметрично левому полю.
 *
 * Что заходит в зону непечати у края листа (таблица шире листа — ошибка
 * вёрстки бланка), не считается. Нечего взять (пустая страница или
 * содержимое только в левой половине листа) — правое поле листа.
 */
export function journalQrContentRight(boxes: PdfBox[], pageWidth: number): number {
  const fallback = pageWidth - JOURNAL_SHEET_MARGIN_MM;
  const limit = pageWidth - JOURNAL_QR_EDGE_MM;
  let right = -Infinity;
  for (const box of boxes) {
    if (isNum(box.x1) && box.x1 <= limit + 1e-6 && box.x1 > right) right = box.x1;
  }
  if (!Number.isFinite(right) || right < pageWidth / 2) return fallback;
  return right;
}

/** Касание (общая граница с точностью до округления) — не пересечение. */
const TOUCH_EPS_MM = 1e-6;

function intersects(a: PdfBox, b: PdfBox): boolean {
  return (
    a.x0 < b.x1 - TOUCH_EPS_MM &&
    b.x0 < a.x1 - TOUCH_EPS_MM &&
    a.y0 < b.y1 - TOUCH_EPS_MM &&
    b.y0 < a.y1 - TOUCH_EPS_MM
  );
}

/**
 * Плитка на странице без шапки: правый верхний угол — верх на верхнем поле
 * листа, правый край вровень с содержимым (`rightEdge`). `null` — угол
 * занят (таблица или текст ближе `JOURNAL_QR_PAD_MM`): строки QR не
 * сдвигает, на такой странице его нет.
 */
export function findJournalQrCorner(params: {
  pageWidth: number;
  tile: { width: number; height: number };
  boxes: PdfBox[];
  rightEdge?: number;
}): PdfBox | null {
  const right = Math.min(params.rightEdge ?? params.pageWidth - JOURNAL_SHEET_MARGIN_MM, params.pageWidth - JOURNAL_QR_EDGE_MM);
  const box = {
    x0: right - params.tile.width,
    y0: JOURNAL_SHEET_MARGIN_MM,
    x1: right,
    y1: JOURNAL_SHEET_MARGIN_MM + params.tile.height,
  };
  if (box.x0 < JOURNAL_SHEET_MARGIN_MM) return null;
  const padded = {
    x0: box.x0 - JOURNAL_QR_PAD_MM,
    y0: box.y0 - JOURNAL_QR_PAD_MM,
    x1: box.x1 + JOURNAL_QR_PAD_MM,
    y1: box.y1 + JOURNAL_QR_PAD_MM,
  };
  return params.boxes.some((b) => intersects(padded, b)) ? null : box;
}

// ---------------------------------------------------------------------------
// Штамп.
// ---------------------------------------------------------------------------

const FOOTER_FONT_SIZE = 6;

/**
 * QR на все страницы документа. Вызывать последним — после нумерации и
 * подвала партнёра; трекер (`trackPdfInk`) — запущенный до отрисовки
 * бланка (для страниц без шапки). Плитка — `prepareJournalQr`, если он
 * был; иначе считается здесь.
 */
export function stampJournalQr(
  doc: jsPDF,
  params: JournalPdfQr & { fontName: string; tracker?: PdfInkTracker | null },
): JournalQrPlacement[] {
  params.tracker?.stop();
  const state = docQr.get(doc);
  const tile = state && state.tile.layout.url === params.url ? state.tile : journalQrTile(params.url);
  const slots = state?.slots ?? new Map<number, PdfBox>();
  const placements: JournalQrPlacement[] = [];
  const total = doc.getNumberOfPages();

  const side = tile.layout.window.w * tile.module;
  const half = JOURNAL_LINE_WIDTH / 2;
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const slot = slots.get(page) ?? null;
    let box: PdfBox | null = null;
    let codeWindow: PdfBox | null = null;
    if (slot) {
      // Ячейка внутри линий: по ширине ровно окно кода, по высоте — сколько
      // дали строки шапки (перенос названия — выше; код тогда по центру окна).
      const x0 = slot.x0 + half + (slot.x1 - slot.x0 - 2 * half - side) / 2;
      box = { x0, y0: slot.y0 + half, x1: x0 + side, y1: slot.y1 - half };
      const stripHeight = (tile.layout.strip?.h ?? 0) * tile.module;
      const y0 = box.y0 + (box.y1 - box.y0 - stripHeight - side) / 2;
      codeWindow = { x0, y0, x1: x0 + side, y1: y0 + side };
    } else {
      const boxes = params.tracker?.boxes(page) ?? [];
      box = findJournalQrCorner({
        pageWidth,
        tile,
        boxes,
        rightEdge: journalQrContentRight(boxes, pageWidth),
      });
      if (box) {
        const w = tile.layout.window;
        const x0 = box.x0 + w.x * tile.module;
        const y0 = box.y0 + w.y * tile.module;
        codeWindow = { x0, y0, x1: x0 + side, y1: y0 + side };
      }
    }
    if (box && !params.probeOnly) {
      if (slot) drawBrandQrCellPdf(doc, tile.layout, box, { fontName: params.fontName });
      else drawBrandQrTilePdf(doc, tile.layout, box.x0, box.y0, tile.width, { fontName: params.fontName });
    }
    if (params.footer && !params.probeOnly) {
      // Базовая линия — на нижнем поле листа, от левого поля (как подвал
      // партнёра); справа на странице без шапки — «СТР. X ИЗ N».
      doc.setFont(params.fontName, "normal");
      doc.setFontSize(FOOTER_FONT_SIZE);
      doc.setTextColor(115, 115, 115);
      doc.text(params.footer, JOURNAL_SHEET_MARGIN_MM, pageHeight - JOURNAL_SHEET_MARGIN_MM);
      doc.setTextColor(0, 0, 0);
    }
    placements.push({
      page,
      where: slot ? "header" : box ? "corner" : "none",
      box,
      window: codeWindow,
      slot,
      modules: tile.modules,
      module: tile.module,
    });
  }

  doc.setFont(params.fontName, "normal");
  doc.setFontSize(10);
  doc.setPage(total);
  return placements;
}
