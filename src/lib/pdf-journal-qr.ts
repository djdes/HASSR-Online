import type { jsPDF } from "jspdf";
import QRCode from "qrcode";

/**
 * Маленький QR-код в правом нижнем углу КАЖДОЙ страницы печатного журнала.
 *
 * Настоящий документ ведёт на основной QR журнала организации (запись с
 * телефона по PIN), образец бланка — на страницу журнала на сайте.
 * Рядом — подпись мелким серым шрифтом.
 *
 * Главный риск — наложиться на таблицу или подпись бланка: 40+ макетов
 * доходят до низа листа по-разному. Поэтому:
 *   1. `trackPdfInk` на время отрисовки записывает прямоугольники всего,
 *      что бланк нарисовал (текст, линии, ячейки, картинки) — по страницам;
 *   2. `reserveJournalQrBottomMargin` поднимает нижнее поле ВСЕХ таблиц
 *      autoTable этого документа до `JOURNAL_QR_BOTTOM_RESERVE_MM`, чтобы
 *      у полной страницы таблицы угол под QR был свободен;
 *   3. `stampJournalQr` ставит QR в нижний угол ВРОВЕНЬ с правой границей
 *      содержимого страницы (правый край таблицы / рамки бланка — симметрично
 *      левому полю, `journalQrRightEdges`), а если угол занят (ручная
 *      вёрстка, подписи внизу) — сдвигает его влево по нижнему полю, затем
 *      выше, в первое свободное место этой страницы.
 *
 * Матрица рисуется векторными квадратами jsPDF (синхронно, чётко на любом
 * принтере), без растровой картинки.
 */

/** Сторона QR (без «тихой зоны»), мм. 41 модуль → 0,32 мм на модуль. */
export const JOURNAL_QR_SIZE_MM = 13;
/** Отступ QR-блока от края листа, мм (зона непечати принтера ≥ 4 мм). */
export const JOURNAL_QR_EDGE_MM = 5;
/**
 * Правое поле по умолчанию, мм: QR встаёт в стольких мм от правого края
 * листа, если на странице нет содержимого, по которому равняться.
 */
export const JOURNAL_QR_DEFAULT_RIGHT_MARGIN_MM = 10;
/** Свободное поле вокруг блока (тихая зона QR + зазор до таблицы), мм. */
export const JOURNAL_QR_PAD_MM = 1.5;
/** Нижнее поле таблиц, при котором угол полной страницы свободен под QR. */
export const JOURNAL_QR_BOTTOM_RESERVE_MM = JOURNAL_QR_EDGE_MM + JOURNAL_QR_SIZE_MM + JOURNAL_QR_PAD_MM + 0.5;
/** Минимальный модуль, который телефон уверенно читает с листа, мм. */
export const JOURNAL_QR_MIN_MODULE_MM = 0.3;

const CAPTION_FONT_SIZE = 6;
// «Заполнение электронного журнала» — одной строкой (≈ 36 мм жирным 6 pt).
const CAPTION_MAX_WIDTH_MM = 42;
const CAPTION_GAP_MM = 1.5;
const CAPTION_LINE_MM = 2.5;
const SEARCH_STEP_MM = 2;

export type JournalPdfQr = {
  /** Адрес, который кодирует QR. */
  url: string;
  /** Подпись слева от QR: первая строка жирная, остальные обычные. */
  lines: string[];
  /**
   * Только для автопроверки «ничего не перекрыто»: место под QR
   * резервируется и считается как обычно, но сам QR и подпись не рисуются —
   * растр такой страницы показывает, что было в зоне QR до штампа.
   */
  probeOnly?: boolean;
};

export type PdfBox = { x0: number; y0: number; x1: number; y1: number };

export type JournalQrPlacement = {
  page: number;
  /** Левый верхний угол матрицы QR, мм. */
  x: number;
  y: number;
  size: number;
  modules: number;
  /** Прямоугольник QR + подпись (без поля), мм. */
  block: PdfBox;
  /** Правая граница содержимого страницы, по которой равняется QR, мм. */
  rightEdge: number;
  /** true — угол был занят, QR сдвинут в свободное место страницы. */
  moved: boolean;
  /** true — QR в нижнем поле листа (в углу или сдвинут влево по низу). */
  bottomRow: boolean;
  /** true — свободного места не нашлось (QR стоит в углу поверх). */
  overlap: boolean;
};

// ---------------------------------------------------------------------------
// Учёт «чернил»: что бланк нарисовал на каждой странице.
// ---------------------------------------------------------------------------

export type PdfInkTracker = {
  boxes(page: number): PdfBox[];
  /** Вернуть методы документа как были (QR и подвал уже не учитываются). */
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

  const pageNumber = () =>
    (doc as jsPDF & { getCurrentPageInfo: () => { pageNumber: number } }).getCurrentPageInfo().pageNumber;
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    if (![x0, y0, x1, y1].every(isNum)) return;
    const page = pageNumber();
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

/**
 * Нижнее поле всех таблиц autoTable этого документа — не меньше `reserveMm`.
 *
 * Отрисовщики передают свой `margin` без `bottom` (autoTable подставляет
 * 14 мм), а документные настройки autoTable целиком заменяются полем
 * вызова. Хуки же складываются: `didParseCell` срабатывает до отрисовки
 * таблицы, и поле правится в её разобранных настройках.
 */
export function reserveJournalQrBottomMargin(doc: jsPDF, reserveMm = JOURNAL_QR_BOTTOM_RESERVE_MM) {
  type Hook = (data: { table?: { settings?: { margin?: { bottom: number } } } }) => void;
  const holder = doc as jsPDF & { __autoTableDocumentDefaults?: Record<string, unknown> };
  const previous = holder.__autoTableDocumentDefaults ?? {};
  const previousHook = previous.didParseCell as Hook | undefined;
  const bump: Hook = (data) => {
    const margin = data.table?.settings?.margin;
    if (margin && isNum(margin.bottom) && margin.bottom < reserveMm) margin.bottom = reserveMm;
    previousHook?.(data);
  };
  holder.__autoTableDocumentDefaults = { ...previous, didParseCell: bump };
}

// ---------------------------------------------------------------------------
// Штамп.
// ---------------------------------------------------------------------------

type CaptionLayout = { lines: { text: string; bold: boolean }[]; width: number; height: number };

function layoutCaption(doc: jsPDF, lines: string[], fontName: string): CaptionLayout {
  const out: { text: string; bold: boolean }[] = [];
  doc.setFontSize(CAPTION_FONT_SIZE);
  lines.forEach((line, index) => {
    const bold = index === 0;
    doc.setFont(fontName, bold ? "bold" : "normal");
    for (const part of doc.splitTextToSize(line, CAPTION_MAX_WIDTH_MM) as string[]) {
      out.push({ text: part, bold });
    }
  });
  let width = 0;
  for (const line of out) {
    doc.setFont(fontName, line.bold ? "bold" : "normal");
    width = Math.max(width, doc.getTextWidth(line.text));
  }
  return { lines: out, width, height: out.length * CAPTION_LINE_MM };
}

/** Ширина QR-блока (QR + подпись), мм — под неё сдвигается «СТР. X ИЗ N». */
export function journalQrBlockWidth(doc: jsPDF, lines: string[], fontName = "JournalUnicode"): number {
  const caption = layoutCaption(doc, lines, fontName);
  doc.setFont(fontName, "normal");
  doc.setFontSize(10);
  return JOURNAL_QR_SIZE_MM + (caption.lines.length ? CAPTION_GAP_MM + caption.width : 0);
}

/**
 * Правая граница подписи «СТР. X ИЗ N» на странице без шапки, считая от
 * правого края листа: левее QR-блока, чтобы номер не лёг под код.
 * `rightInset` — отступ правого края QR от края листа на этой странице
 * (`pageWidth - journalQrRightEdges(...)[page - 1]`).
 */
export function journalQrFooterInset(
  doc: jsPDF,
  lines: string[],
  fontName = "JournalUnicode",
  rightInset = JOURNAL_QR_DEFAULT_RIGHT_MARGIN_MM,
): number {
  return rightInset + journalQrBlockWidth(doc, lines, fontName) + 3;
}

/**
 * Правая граница содержимого страницы, мм от левого края листа: самый
 * правый край нарисованного бланком (таблица, рамка, шапка). По ней QR
 * встаёт вровень с таблицей — симметрично левому полю.
 *
 * Что заходит в зону непечати у края листа (таблица шире листа — ошибка
 * вёрстки бланка), не считается: QR равняется на то, что на листе целиком
 * (обычно рамка шапки). Нечего взять (пустая страница или содержимое только
 * в левой половине листа) — поле по умолчанию.
 */
export function journalQrContentRight(boxes: PdfBox[], pageWidth: number): number {
  const fallback = pageWidth - JOURNAL_QR_DEFAULT_RIGHT_MARGIN_MM;
  const limit = pageWidth - JOURNAL_QR_EDGE_MM;
  let right = -Infinity;
  for (const box of boxes) {
    if (isNum(box.x1) && box.x1 <= limit + 1e-6 && box.x1 > right) right = box.x1;
  }
  if (!Number.isFinite(right) || right < pageWidth / 2) return fallback;
  return right;
}

/**
 * Правая граница QR на каждой странице документа (индекс = страница − 1).
 * Считать ДО нумерации страниц и подвала партнёра: их место зависит от
 * положения QR, а сами они стоят левее и границу не сдвигают.
 */
export function journalQrRightEdges(doc: jsPDF, tracker: PdfInkTracker | null | undefined): number[] {
  const edges: number[] = [];
  const total = doc.getNumberOfPages();
  const current = (doc as jsPDF & { getCurrentPageInfo: () => { pageNumber: number } }).getCurrentPageInfo().pageNumber;
  for (let page = 1; page <= total; page += 1) {
    // Размер листа — свой у каждой страницы (приложение бывает книжным).
    doc.setPage(page);
    edges.push(journalQrContentRight(tracker?.boxes(page) ?? [], doc.internal.pageSize.getWidth()));
  }
  doc.setPage(current);
  return edges;
}

function intersects(a: PdfBox, b: PdfBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** QR-блок в точке (qrX, qrY) — левый верхний угол матрицы. */
function blockAt(qrX: number, qrY: number, size: number, caption: CaptionLayout): PdfBox {
  const captionWidth = caption.lines.length ? caption.width + CAPTION_GAP_MM : 0;
  const top = Math.min(qrY, qrY + size / 2 - caption.height / 2);
  const bottom = Math.max(qrY + size, qrY + size / 2 + caption.height / 2);
  return { x0: qrX - captionWidth, y0: top, x1: qrX + size, y1: bottom };
}

function isFree(block: PdfBox, boxes: PdfBox[]): boolean {
  const padded = {
    x0: block.x0 - JOURNAL_QR_PAD_MM,
    y0: block.y0 - JOURNAL_QR_PAD_MM,
    x1: block.x1 + JOURNAL_QR_PAD_MM,
    y1: block.y1 + JOURNAL_QR_PAD_MM,
  };
  for (const box of boxes) if (intersects(padded, box)) return false;
  return true;
}

/**
 * Место под QR на странице: угол → влево по нижнему полю → выше (ряд за
 * рядом, справа налево). `null` — свободного места нет.
 */
export function findJournalQrSpot(params: {
  pageWidth: number;
  pageHeight: number;
  size: number;
  captionWidth: number;
  captionHeight: number;
  boxes: PdfBox[];
  /**
   * Где должен кончаться QR справа, мм от левого края листа (правая граница
   * таблицы). По умолчанию — `JOURNAL_QR_EDGE_MM` от края листа.
   */
  rightEdge?: number;
}): { x: number; y: number; moved: boolean; bottomRow: boolean } | null {
  const { pageWidth, pageHeight, size, boxes } = params;
  const rightEdge = Math.min(params.rightEdge ?? pageWidth - JOURNAL_QR_EDGE_MM, pageWidth - JOURNAL_QR_EDGE_MM);
  const caption: CaptionLayout = {
    lines: params.captionWidth > 0 ? [{ text: "", bold: false }] : [],
    width: params.captionWidth,
    height: params.captionHeight,
  };
  const leftmost = JOURNAL_QR_EDGE_MM + (params.captionWidth > 0 ? params.captionWidth + CAPTION_GAP_MM : 0);
  const rightmost = rightEdge - size;
  const bottom = pageHeight - JOURNAL_QR_EDGE_MM - size;
  const fits = (x: number, y: number) => {
    const block = blockAt(x, y, size, caption);
    return block.y1 <= pageHeight - JOURNAL_QR_EDGE_MM + 1e-6 && block.y0 >= JOURNAL_QR_EDGE_MM && isFree(block, boxes);
  };
  if (fits(rightmost, bottom)) return { x: rightmost, y: bottom, moved: false, bottomRow: true };
  for (let y = bottom; y >= JOURNAL_QR_EDGE_MM; y -= SEARCH_STEP_MM) {
    for (let x = rightmost; x >= leftmost; x -= SEARCH_STEP_MM) {
      if (fits(x, y)) return { x, y, moved: true, bottomRow: y === bottom };
    }
  }
  return null;
}

function drawMatrix(doc: jsPDF, qr: QRCode.QRCode, x: number, y: number, size: number) {
  const n = qr.modules.size;
  const cell = size / n;
  doc.setFillColor(0, 0, 0);
  for (let row = 0; row < n; row += 1) {
    // Подряд идущие тёмные модули строки — одним прямоугольником.
    let col = 0;
    while (col < n) {
      if (!qr.modules.get(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < n && qr.modules.get(row, col)) col += 1;
      // +0.01 мм — без «волосяных» щелей между соседними строками.
      doc.rect(x + start * cell, y + row * cell, (col - start) * cell, cell + 0.01, "F");
    }
  }
}

export function journalQrMatrix(url: string): QRCode.QRCode {
  return QRCode.create(url, { errorCorrectionLevel: "M" });
}

/**
 * Штамп на все страницы документа. Вызывать последним — после нумерации
 * и подвала партнёра, с трекером, запущенным до отрисовки бланка.
 */
export function stampJournalQr(
  doc: jsPDF,
  params: JournalPdfQr & {
    fontName?: string;
    tracker?: PdfInkTracker | null;
    /** Правая граница QR по страницам (`journalQrRightEdges`); нет — считается здесь. */
    rightEdges?: number[] | null;
  },
): JournalQrPlacement[] {
  const fontName = params.fontName ?? "JournalUnicode";
  const rightEdges = params.rightEdges ?? journalQrRightEdges(doc, params.tracker);
  params.tracker?.stop();
  const qr = journalQrMatrix(params.url);
  const modules = qr.modules.size;
  const size = JOURNAL_QR_SIZE_MM;
  if (size / modules < JOURNAL_QR_MIN_MODULE_MM - 1e-9) {
    throw new Error(`QR слишком плотный для печати: ${modules} модулей на ${size} мм`);
  }
  const caption = layoutCaption(doc, params.lines, fontName);
  const captionWidth = caption.lines.length ? caption.width : 0;
  const placements: JournalQrPlacement[] = [];
  const total = doc.getNumberOfPages();

  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const rightEdge = rightEdges[page - 1] ?? journalQrContentRight(params.tracker?.boxes(page) ?? [], pageWidth);
    const spot = findJournalQrSpot({
      pageWidth,
      pageHeight,
      size,
      captionWidth,
      captionHeight: caption.height,
      boxes: params.tracker?.boxes(page) ?? [],
      rightEdge,
    });
    const x = spot?.x ?? Math.min(rightEdge, pageWidth - JOURNAL_QR_EDGE_MM) - size;
    const y = spot?.y ?? pageHeight - JOURNAL_QR_EDGE_MM - size;
    if (!params.probeOnly) drawMatrix(doc, qr, x, y, size);

    if (caption.lines.length && !params.probeOnly) {
      doc.setFontSize(CAPTION_FONT_SIZE);
      doc.setTextColor(111, 114, 130);
      const textRight = x - CAPTION_GAP_MM;
      // Базовая линия первой строки — так, чтобы блок строк стоял по центру QR.
      let lineY = y + size / 2 - caption.height / 2 + CAPTION_LINE_MM * 0.78;
      for (const line of caption.lines) {
        doc.setFont(fontName, line.bold ? "bold" : "normal");
        doc.text(line.text, textRight, lineY, { align: "right" });
        lineY += CAPTION_LINE_MM;
      }
      doc.setTextColor(0, 0, 0);
    }

    placements.push({
      page,
      x,
      y,
      size,
      modules,
      block: blockAt(x, y, size, caption),
      rightEdge,
      moved: spot?.moved ?? false,
      bottomRow: spot?.bottomRow ?? true,
      overlap: spot === null,
    });
  }

  doc.setFont(fontName, "normal");
  doc.setFontSize(10);
  doc.setPage(total);
  return placements;
}
