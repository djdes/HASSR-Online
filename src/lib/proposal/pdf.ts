import fs from "node:fs";
import path from "node:path";

import { jsPDF } from "jspdf";

import { brandQrLayout, drawBrandQrTilePdf } from "@/lib/brand-qr";

import type { ProposalContent, ProposalJournalItem, ProposalOfferRow } from "./content";
import { registerProposalFonts, type ProposalFonts, type ProposalWeight } from "./pdf-font";

/**
 * КП на одном листе A4 (jsPDF, вектор).
 *
 * Вёрстка — «измерить, потом рисовать»: каждый блок сначала считает свою
 * высоту по реальным метрикам шрифта (`splitTextToSize`/`getTextWidth`),
 * и если лист не помещается (длинное название компании, много журналов у
 * сферы), кегли и отступы уменьшаются ступенями (`scale`) до той, при
 * которой всё влезает. Не влезло даже на самой мелкой — ошибка, а не
 * обрезанный текст: так упадёт тест, а не клиентский PDF.
 *
 * Всё нарисованное записывается в `bounds` — по ним тест проверяет, что
 * ничего не вылезает за поля.
 *
 * Цвета — токены сайта. Мелкий текст — только тёмными (#0b1024, #3c4053,
 * #3848c7): при ч/б печати индиго #5566f6 выходит средне-серым, им
 * рисуются только крупные элементы и заливки.
 */

type RGB = readonly [number, number, number];

const INK: RGB = [11, 16, 36];
const BODY: RGB = [60, 64, 83];
const MUTED: RGB = [111, 114, 130];
const ACCENT: RGB = [85, 102, 246];
const ACCENT_DEEP: RGB = [56, 72, 199];
const TINT: RGB = [245, 246, 255];
const TINT_2: RGB = [238, 241, 255];
const LINE: RGB = [220, 223, 237];
const WHITE: RGB = [255, 255, 255];

export const PAGE_W = 210;
export const PAGE_H = 297;
export const MARGIN_X = 14;
export const MARGIN_TOP = 12;
export const MARGIN_BOTTOM = 12;
const CONTENT_W = PAGE_W - 2 * MARGIN_X;

/** pt → мм. */
const PT = 25.4 / 72;
/** Высота заглавных Manrope — доля кегля (OS/2 sCapHeight 1440 / 2000). */
const CAP = 0.72;

/**
 * Плотность вёрстки: 1 — обычные кегли и отступы. Не влезает — ищется
 * наибольшая плотность в [MIN_SCALE, 1], при которой лист помещается
 * (двоичный поиск с шагом ~0,5 %), чтобы не мельчить сильнее нужного.
 */
const MIN_SCALE = 0.8;
const SCALE_STEP = 0.005;

export type PdfBox = { x0: number; y0: number; x1: number; y1: number; what: string };

export type ProposalPdfLayout = "a" | "b";

export type ProposalPdfRender = {
  buffer: Buffer;
  pages: number;
  /** Габариты всего нарисованного, мм. */
  bounds: PdfBox[];
  /** Ступень плотности, на которой всё поместилось. */
  scale: number;
  qr: { url: string; box: PdfBox; module: number };
};

type TextOptions = {
  size: number;
  weight?: ProposalWeight;
  color?: RGB;
  lh?: number;
  align?: "left" | "right" | "center";
  charSpace?: number;
  what?: string;
};

type Span = { text: string; weight?: ProposalWeight; color?: RGB; strike?: boolean };

class Painter {
  readonly bounds: PdfBox[] = [];

  constructor(
    readonly doc: jsPDF,
    readonly fonts: ProposalFonts,
    readonly dry: boolean,
  ) {}

  mark(x0: number, y0: number, x1: number, y1: number, what: string) {
    this.bounds.push({ x0, y0, x1, y1, what });
  }

  font(weight: ProposalWeight, size: number) {
    const face = this.fonts.face[weight];
    this.doc.setFont(face.family, face.style);
    this.doc.setFontSize(size);
  }

  width(text: string, weight: ProposalWeight, size: number, charSpace = 0): number {
    this.font(weight, size);
    return this.doc.getTextWidth(text) + charSpace * Math.max(0, Array.from(text).length - 1);
  }

  split(text: string, weight: ProposalWeight, size: number, maxWidth: number): string[] {
    this.font(weight, size);
    return this.doc.splitTextToSize(text, maxWidth) as string[];
  }

  /** Строки текста сверху вниз от `y`; возвращает высоту блока. */
  text(input: string | string[], x: number, y: number, width: number, o: TextOptions): number {
    const weight = o.weight ?? "regular";
    const lh = o.lh ?? 1.4;
    const lines = Array.isArray(input) ? input : this.split(input, weight, o.size, width);
    const s = o.size * PT;
    const l = s * lh;
    lines.forEach((line, index) => {
      const top = y + index * l;
      const baseline = top + l / 2 + (CAP * s) / 2;
      const w = this.width(line, weight, o.size, o.charSpace ?? 0);
      const lx = o.align === "right" ? x + width - w : o.align === "center" ? x + (width - w) / 2 : x;
      if (!this.dry) {
        this.font(weight, o.size);
        this.doc.setTextColor(...(o.color ?? INK));
        this.doc.text(line, lx, baseline, o.charSpace ? { charSpace: o.charSpace } : undefined);
      }
      this.mark(lx, top, lx + w, top + l, o.what ?? "text");
    });
    return lines.length * l;
  }

  /**
   * Абзац из кусков разного начертания и цвета с переносом по словам.
   * Неразрывный пробел — часть слова («41 журнал», «1 990 ₽»).
   */
  rich(spans: Span[], x: number, y: number, width: number, size: number, lh = 1.4, what = "rich"): number {
    type Word = { text: string; weight: ProposalWeight; color: RGB; strike: boolean; w: number; space: boolean };
    const words: Word[] = [];
    for (const span of spans) {
      const weight = span.weight ?? "regular";
      const parts = span.text.split(" ");
      let pendingSpace = false;
      parts.forEach((part, index) => {
        // Пустая часть — пробел в начале куска или двойной пробел.
        if (!part) {
          pendingSpace = true;
          return;
        }
        words.push({
          text: part,
          weight,
          color: span.color ?? INK,
          strike: span.strike ?? false,
          w: this.width(part, weight, size),
          // Первое слово куска приклеивается к предыдущему («1 990 ₽» + «/мес»),
          // если кусок не начинается с пробела.
          space: index > 0 || pendingSpace,
        });
        pendingSpace = false;
      });
    }
    const spaceW = (weight: ProposalWeight) => this.width(" ", weight, size);
    const lines: Word[][] = [];
    let line: Word[] = [];
    let used = 0;
    words.forEach((word) => {
      const gap = line.length > 0 && word.space ? spaceW(word.weight) : 0;
      if (line.length > 0 && used + gap + word.w > width + 1e-6) {
        lines.push(line);
        line = [];
        used = 0;
      }
      used += (line.length > 0 ? gap : 0) + word.w;
      line.push(word);
    });
    if (line.length > 0) lines.push(line);
    const s = size * PT;
    const l = s * lh;
    lines.forEach((items, row) => {
      const top = y + row * l;
      const baseline = top + l / 2 + (CAP * s) / 2;
      let cx = x;
      items.forEach((word, index) => {
        if (index > 0 && word.space) cx += spaceW(word.weight);
        if (!this.dry) {
          this.font(word.weight, size);
          this.doc.setTextColor(...word.color);
          this.doc.text(word.text, cx, baseline);
          if (word.strike) {
            this.doc.setDrawColor(...word.color);
            this.doc.setLineWidth(Math.max(0.2, s * 0.07));
            const sy = baseline - CAP * s * 0.42;
            this.doc.line(cx - 0.3, sy, cx + word.w + 0.3, sy);
          }
        }
        cx += word.w;
      });
      this.mark(x, top, cx, top + l, what);
    });
    return lines.length * l;
  }

  box(x: number, y: number, w: number, h: number, o: { fill?: RGB; stroke?: RGB; r?: number; lw?: number; what?: string }) {
    if (!this.dry) {
      if (o.fill) this.doc.setFillColor(...o.fill);
      if (o.stroke) {
        this.doc.setDrawColor(...o.stroke);
        this.doc.setLineWidth(o.lw ?? 0.3);
      }
      const style = o.fill && o.stroke ? "FD" : o.fill ? "F" : "S";
      if (o.r && o.r > 0) this.doc.roundedRect(x, y, w, h, o.r, o.r, style);
      else this.doc.rect(x, y, w, h, style);
    }
    this.mark(x, y, x + w, y + h, o.what ?? "box");
  }

  line(x0: number, y0: number, x1: number, y1: number, color: RGB, lw = 0.3) {
    if (!this.dry) {
      this.doc.setDrawColor(...color);
      this.doc.setLineWidth(lw);
      this.doc.line(x0, y0, x1, y1);
    }
    this.mark(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), "line");
  }

  dot(cx: number, cy: number, r: number, color: RGB, filled: boolean) {
    if (!this.dry) {
      if (filled) {
        this.doc.setFillColor(...color);
        this.doc.circle(cx, cy, r, "F");
      } else {
        this.doc.setDrawColor(...color);
        this.doc.setLineWidth(0.28);
        this.doc.circle(cx, cy, r, "S");
      }
    }
    this.mark(cx - r, cy - r, cx + r, cy + r, "dot");
  }

  /** Галочка в круге — маркер преимущества. */
  check(x: number, y: number, size: number) {
    const r = size / 2;
    const cx = x + r;
    const cy = y + r;
    if (!this.dry) {
      this.doc.setFillColor(...TINT_2);
      this.doc.circle(cx, cy, r, "F");
      this.doc.setDrawColor(...ACCENT_DEEP);
      this.doc.setLineWidth(size * 0.12);
      this.doc.setLineCap("round");
      this.doc.setLineJoin("round");
      this.doc.lines(
        [
          [size * 0.16, size * 0.16],
          [size * 0.3, -size * 0.34],
        ],
        cx - size * 0.24,
        cy + size * 0.01,
        [1, 1],
        "S",
        false,
      );
      this.doc.setLineCap("butt");
    }
    this.mark(x, y, x + size, y + size, "check");
  }

  /** Номер шага в круге. */
  number(x: number, y: number, size: number, value: string) {
    const r = size / 2;
    if (!this.dry) {
      this.doc.setFillColor(...ACCENT);
      this.doc.circle(x + r, y + r, r, "F");
    }
    this.mark(x, y, x + size, y + size, "number");
    const fontSize = (size / PT) * 0.52;
    const s = fontSize * PT;
    const w = this.width(value, "extrabold", fontSize);
    if (!this.dry) {
      this.font("extrabold", fontSize);
      this.doc.setTextColor(...WHITE);
      this.doc.text(value, x + r - w / 2, y + r + (CAP * s) / 2);
    }
  }

  image(data: Buffer, x: number, y: number, w: number, h: number, what: string) {
    if (!this.dry) this.doc.addImage(new Uint8Array(data), "PNG", x, y, w, h, undefined, "FAST");
    this.mark(x, y, x + w, y + h, what);
  }
}

// ---------------------------------------------------------------------------
// Знак сайта
// ---------------------------------------------------------------------------

const WORDMARK_FILE = path.join(process.cwd(), "public", "brand", "wordmark-dark.png");
/** Пропорция файла знака (900 × 239). */
const WORDMARK_RATIO = 900 / 239;
let wordmarkCache: Buffer | null | undefined;

function wordmark(): Buffer | null {
  if (wordmarkCache !== undefined) return wordmarkCache;
  wordmarkCache = fs.existsSync(WORDMARK_FILE) ? fs.readFileSync(WORDMARK_FILE) : null;
  return wordmarkCache;
}

// ---------------------------------------------------------------------------
// Общие блоки
// ---------------------------------------------------------------------------

type Ctx = { p: Painter; k: number; content: ProposalContent };

/** Размер с учётом ступени плотности. */
const sz = (ctx: Ctx, pt: number) => pt * ctx.k;
const gap = (ctx: Ctx, mm: number) => mm * ctx.k;

function drawHeader(ctx: Ctx, y: number): number {
  const { p, content } = ctx;
  const markH = 7.2;
  const mark = wordmark();
  if (mark) p.image(mark, MARGIN_X, y, markH * WORDMARK_RATIO, markH, "wordmark");
  else p.text("WeSetup", MARGIN_X, y, 60, { size: 16, weight: "extrabold" });
  p.text(content.eyebrow.toUpperCase(), MARGIN_X, y + 0.2, CONTENT_W, {
    size: 6.8,
    weight: "semibold",
    color: MUTED,
    align: "right",
    charSpace: 0.35,
    what: "eyebrow",
  });
  p.text(`${content.dateLabel} · ${content.site}`, MARGIN_X, y + 4, CONTENT_W, {
    size: 8.2,
    color: BODY,
    align: "right",
    what: "date",
  });
  const bottom = y + markH + 3.2;
  p.line(MARGIN_X, bottom, PAGE_W - MARGIN_X, bottom, LINE, 0.3);
  return bottom - y;
}

function drawTitle(ctx: Ctx, x: number, y: number, width: number, titleSize: number): number {
  const { p, content } = ctx;
  let h = 0;
  if (content.addressee) {
    h += p.text(content.addressee, x, y, width, {
      size: sz(ctx, 9.5),
      weight: "semibold",
      color: ACCENT_DEEP,
      lh: 1.35,
      what: "addressee",
    });
    h += gap(ctx, 1.6);
  }
  // «для кафе и кофейни» не рвётся посередине, если помещается строкой целиком.
  const size = sz(ctx, titleSize);
  const together = content.titleFor.replace(/ /g, "\u00a0");
  const forText = p.width(together, "extrabold", size) <= width ? together : content.titleFor;
  h += p.rich(
    [
      { text: content.titleLead, weight: "extrabold", color: INK },
      { text: ` ${forText}`, weight: "extrabold", color: ACCENT },
    ],
    x,
    y + h,
    width,
    size,
    1.13,
    "title",
  );
  return h;
}

function sectionLabel(ctx: Ctx, text: string, x: number, y: number, width: number): number {
  return ctx.p.text(text.toUpperCase(), x, y, width, {
    size: sz(ctx, 6.9),
    weight: "semibold",
    color: MUTED,
    lh: 1.3,
    charSpace: 0.32,
    what: "label",
  });
}

function drawBenefits(ctx: Ctx, x: number, y: number, width: number): number {
  const { p, content } = ctx;
  let h = sectionLabel(ctx, content.benefitsTitle, x, y, width) + gap(ctx, 2.2);
  const icon = 4.2 * ctx.k;
  const indent = icon + 2.4;
  content.benefits.forEach((item, index) => {
    if (index > 0) h += gap(ctx, 2.6);
    p.check(x, y + h + 0.1, icon);
    h += p.text(item.title, x + indent, y + h, width - indent, {
      size: sz(ctx, 9.2),
      weight: "extrabold",
      lh: 1.3,
      what: "benefit-title",
    });
    h += p.text(item.text, x + indent, y + h + 0.3, width - indent, {
      size: sz(ctx, 8.3),
      color: BODY,
      lh: 1.38,
      what: "benefit",
    }) + 0.3;
  });
  return h;
}

function journalItems(ctx: Ctx, items: ProposalJournalItem[], x: number, y: number, width: number, filled: boolean): number {
  const { p } = ctx;
  let h = 0;
  const size = sz(ctx, 8.2);
  const lh = 1.32;
  items.forEach((item, index) => {
    if (index > 0) h += gap(ctx, 1.1);
    const line = size * PT * lh;
    p.dot(x + 1, y + h + line / 2, 0.85 * ctx.k, ACCENT, filled);
    const spans: Span[] = [{ text: item.name, color: INK }];
    if (item.note) spans.push({ text: ` — ${item.note}`, color: MUTED });
    h += p.rich(spans, x + 4, y + h, width - 4, size, lh, "journal");
  });
  return h;
}

function drawJournals(ctx: Ctx, x: number, y: number, width: number): number {
  const { p, content } = ctx;
  let h = sectionLabel(ctx, content.journalsTitle, x, y, width) + gap(ctx, 2.2);
  if (content.journalsRequired.length > 0) {
    h += p.text("Обязательные", x, y + h, width, { size: sz(ctx, 8), weight: "semibold", color: ACCENT_DEEP, lh: 1.3 });
    h += gap(ctx, 1);
    h += journalItems(ctx, content.journalsRequired, x, y + h, width, true);
  }
  if (content.journalsRecommended.length > 0) {
    h += gap(ctx, 2.2);
    h += p.text("Рекомендуем", x, y + h, width, { size: sz(ctx, 8), weight: "semibold", color: ACCENT_DEEP, lh: 1.3 });
    h += gap(ctx, 1);
    h += journalItems(ctx, content.journalsRecommended, x, y + h, width, false);
  }
  h += gap(ctx, 2);
  const tail: Span[] = [];
  if (content.journalsMore) tail.push({ text: `${capitalizeFirst(content.journalsMore)}.`, weight: "semibold", color: INK });
  tail.push({ text: ` ${content.journalsTotal}`, color: BODY });
  h += p.rich(tail, x, y + h, width, sz(ctx, 7.9), 1.38, "journals-total");
  return h;
}

function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * Цена крупно и «/мес» мелко на одной базовой линии; не влезает в ширину —
 * «/мес» переносится под цену. Возвращает высоту.
 */
function priceLine(ctx: Ctx, price: string, unit: string, x: number, y: number, width: number, size: number): number {
  const { p } = ctx;
  const s = size * PT;
  const lineH = s * 1.12;
  const unitSize = size * 0.46;
  const pw = p.width(price, "extrabold", size);
  const uw = unit ? p.width(unit, "semibold", unitSize) : 0;
  const baseline = y + lineH / 2 + (CAP * s) / 2;
  if (!p.dry) {
    p.font("extrabold", size);
    p.doc.setTextColor(...INK);
    p.doc.text(price, x, baseline);
  }
  p.mark(x, y, x + pw, y + lineH, "price");
  if (!unit) return lineH;
  const inline = pw + 1 + uw <= width;
  const ux = inline ? x + pw + 1 : x;
  const uy = inline ? baseline : baseline + unitSize * PT * 1.5;
  if (!p.dry) {
    p.font("semibold", unitSize);
    p.doc.setTextColor(...BODY);
    p.doc.text(unit, ux, uy);
  }
  p.mark(ux, uy - CAP * unitSize * PT, ux + uw, uy + 0.3 * unitSize * PT, "price-unit");
  return inline ? lineH : lineH + unitSize * PT * 1.5;
}

/** Строка предложения: цена слева, описание справа. */
function offerRow(ctx: Ctx, row: ProposalOfferRow, x: number, y: number, width: number, priceW: number): number {
  const { p } = ctx;
  let left = 0;
  if (row.oldPrice) {
    left += p.rich([{ text: row.oldPrice, weight: "semibold", color: MUTED, strike: true }], x, y, priceW, sz(ctx, 9.5), 1.2, "old-price");
  }
  left += priceLine(ctx, row.price, row.unit, x, y + left, priceW, sz(ctx, 17));
  if (row.badge) {
    left += gap(ctx, 1.4);
    const bs = sz(ctx, 7.2);
    const bw = p.width(row.badge, "extrabold", bs) + 3.6;
    const bh = bs * PT * 1.7;
    p.box(x, y + left, Math.min(bw, priceW), bh, { fill: ACCENT_DEEP, r: bh / 2, what: "badge" });
    p.text(row.badge, x, y + left, Math.min(bw, priceW), {
      size: bs,
      weight: "extrabold",
      color: WHITE,
      align: "center",
      lh: 1.7,
      what: "badge-text",
    });
    left += bh;
  }
  const tx = x + priceW + gap(ctx, 4);
  const tw = width - priceW - gap(ctx, 4);
  let right = p.text(row.title, tx, y, tw, { size: sz(ctx, 9.6), weight: "extrabold", lh: 1.28, what: "offer-title" });
  right += gap(ctx, 0.8);
  right += p.text(row.text, tx, y + right, tw, { size: sz(ctx, 8.2), color: BODY, lh: 1.38, what: "offer-text" });
  return Math.max(left, right);
}

/** QR-плитка и подпись под ней; возвращает высоту и габариты окна кода. */
function drawQr(ctx: Ctx, x: number, y: number, width: number): { h: number; box: PdfBox; module: number } {
  const { p, content } = ctx;
  const layout = brandQrLayout(content.offer.ctaUrl);
  const height = (layout.height / layout.width) * width;
  let placed = { x0: x, y0: y, x1: x + width, y1: y + height };
  let module = width / layout.width;
  if (!p.dry) {
    const drawn = drawBrandQrTilePdf(p.doc, layout, x, y, width, { fontName: p.fonts.face.semibold.family });
    placed = drawn.window;
    module = drawn.module;
  }
  p.mark(x, y, x + width, y + height, "qr");
  let h = height + gap(ctx, 2);
  if (content.offer.promoCode) {
    const size = sz(ctx, 10.5);
    const text = content.offer.promoCode;
    const tw = p.width(text, "extrabold", size, 0.4);
    const bw = Math.min(width, tw + 5);
    const bh = size * PT * 1.9;
    const bx = x + (width - bw) / 2;
    if (!p.dry) {
      p.doc.setLineDashPattern([1, 0.8], 0);
    }
    p.box(bx, y + h, bw, bh, { fill: WHITE, stroke: ACCENT_DEEP, lw: 0.35, r: 1.6, what: "promo-code" });
    if (!p.dry) p.doc.setLineDashPattern([], 0);
    p.text(text, bx, y + h, bw, { size, weight: "extrabold", color: INK, align: "center", lh: 1.9, charSpace: 0.4, what: "promo-code-text" });
    h += bh;
  } else {
    // Адрес под QR — одной строкой: кегль уменьшается, пока адрес не влезет
    // в ширину плитки (перенос посреди адреса читается как два адреса).
    let size = sz(ctx, 7.6);
    while (size > 5.2 && p.width(content.offer.qrCaption, "semibold", size) > width) size -= 0.2;
    h += p.text([content.offer.qrCaption], x, y + h, width, { size, weight: "semibold", color: BODY, align: "center", lh: 1.3, what: "qr-caption" });
  }
  return { h, box: { ...placed, what: "qr-window" }, module };
}

function drawFooter(ctx: Ctx, bottom: number, twoColumns: boolean): number {
  const { p, content } = ctx;
  // Высота считается «сухо» от низа листа: сначала меряем, потом рисуем.
  const measure = (dry: boolean, top: number): number => {
    const q = dry ? new Painter(p.doc, p.fonts, true) : p;
    let left = 0;
    const leftW = twoColumns ? CONTENT_W * 0.5 : CONTENT_W;
    if (content.sender) {
      left += q.text(content.sender.name, MARGIN_X, top + left, leftW, { size: sz(ctx, 8.8), weight: "extrabold", lh: 1.3, what: "sender" });
      const parts = content.sender.lines.map((line) => line.value);
      if (parts.length > 0) {
        left += q.text(parts.join("  ·  "), MARGIN_X, top + left, leftW, { size: sz(ctx, 8), color: BODY, lh: 1.38, what: "sender-lines" });
      }
    }
    let right = 0;
    if (content.requisites) {
      const rx = twoColumns ? MARGIN_X + CONTENT_W * 0.5 + 4 : MARGIN_X;
      const rw = twoColumns ? CONTENT_W * 0.5 - 4 : CONTENT_W;
      const ry = twoColumns ? top : top + left + 1.2;
      right = q.text(content.requisites.join(" · "), rx, ry, rw, {
        size: sz(ctx, 6.9),
        color: MUTED,
        lh: 1.38,
        align: twoColumns ? "right" : "left",
        what: "requisites",
      });
      if (!twoColumns) return left + 1.2 + right;
    }
    return Math.max(left, right);
  };
  const inner = measure(true, 0);
  const top = bottom - inner;
  p.line(MARGIN_X, top - 3, PAGE_W - MARGIN_X, top - 3, LINE, 0.3);
  measure(false, top);
  return inner + 3;
}

// ---------------------------------------------------------------------------
// Композиция A — сверху вниз, предложение внизу во всю ширину
// ---------------------------------------------------------------------------

function composeA(ctx: Ctx): { bottom: number; qr: { box: PdfBox; module: number } } {
  const { p, content } = ctx;
  let y = MARGIN_TOP;
  y += drawHeader(ctx, y) + gap(ctx, 5);
  y += drawTitle(ctx, MARGIN_X, y, CONTENT_W, 21) + gap(ctx, 3.2);
  y += p.text(content.lead, MARGIN_X, y, CONTENT_W - 6, { size: sz(ctx, 9.8), color: BODY, lh: 1.45, what: "lead" });
  y += gap(ctx, 6);

  // Как это работает — три карточки в ряд.
  y += sectionLabel(ctx, "Как это работает", MARGIN_X, y, CONTENT_W) + gap(ctx, 2.4);
  const colGap = 4;
  const cardW = (CONTENT_W - 2 * colGap) / 3;
  const pad = 3.6 * ctx.k;
  const numSize = 6.2 * ctx.k;
  const cardHeights = content.steps.map((step) => {
    const q = new Painter(p.doc, p.fonts, true);
    let h = pad + numSize + gap(ctx, 2);
    h += q.text(step.title, 0, 0, cardW - 2 * pad, { size: sz(ctx, 9.4), weight: "extrabold", lh: 1.28 });
    h += gap(ctx, 0.8);
    h += q.text(step.text, 0, 0, cardW - 2 * pad, { size: sz(ctx, 8.1), color: BODY, lh: 1.38 });
    return h + pad;
  });
  const cardH = Math.max(...cardHeights);
  content.steps.forEach((step, index) => {
    const x = MARGIN_X + index * (cardW + colGap);
    p.box(x, y, cardW, cardH, { fill: TINT, r: 2.6, what: "step-card" });
    p.number(x + pad, y + pad, numSize, String(index + 1));
    let h = pad + numSize + gap(ctx, 2);
    h += p.text(step.title, x + pad, y + h, cardW - 2 * pad, { size: sz(ctx, 9.4), weight: "extrabold", lh: 1.28, what: "step-title" });
    h += gap(ctx, 0.8);
    p.text(step.text, x + pad, y + h, cardW - 2 * pad, { size: sz(ctx, 8.1), color: BODY, lh: 1.38, what: "step" });
  });
  y += cardH + gap(ctx, 2.8);
  y += p.text(content.stepsNote, MARGIN_X, y, CONTENT_W, { size: sz(ctx, 8.1), color: BODY, lh: 1.4, what: "steps-note" });
  y += gap(ctx, 6);

  // Преимущества и журналы — две колонки.
  const colW = (CONTENT_W - 8) / 2;
  const leftH = drawBenefits(ctx, MARGIN_X, y, colW);
  const rightH = drawJournals(ctx, MARGIN_X + colW + 8, y, colW);
  y += Math.max(leftH, rightH) + gap(ctx, 6);

  // Предложение — панель во всю ширину, QR справа.
  const panelPad = 5 * ctx.k;
  const qrW = 38 * ctx.k;
  const innerW = CONTENT_W - 2 * panelPad - qrW - 7;
  const priceW = 31 * ctx.k;
  const measureOffer = (painter: Painter, top: number): number => {
    const c = { ...ctx, p: painter };
    let h = 0;
    h += painter.text(content.offer.title.toUpperCase(), MARGIN_X + panelPad, top + h, innerW, {
      size: sz(ctx, 7.2),
      weight: "extrabold",
      color: ACCENT_DEEP,
      lh: 1.3,
      charSpace: 0.35,
      what: "offer-label",
    });
    h += gap(ctx, 3);
    h += offerRow(c, content.offer.rows[0], MARGIN_X + panelPad, top + h, innerW, priceW);
    h += gap(ctx, 3);
    painter.line(MARGIN_X + panelPad, top + h, MARGIN_X + panelPad + innerW, top + h, LINE, 0.3);
    h += gap(ctx, 3);
    h += offerRow(c, content.offer.rows[1], MARGIN_X + panelPad, top + h, innerW, priceW);
    for (const note of content.offer.notes) {
      h += gap(ctx, 2.2);
      h += painter.text(note, MARGIN_X + panelPad, top + h, innerW, { size: sz(ctx, 8), weight: "semibold", color: ACCENT_DEEP, lh: 1.38, what: "offer-note" });
    }
    h += gap(ctx, 3);
    h += painter.text(content.offer.howTo, MARGIN_X + panelPad, top + h, innerW, { size: sz(ctx, 8.6), weight: "extrabold", color: INK, lh: 1.38, what: "offer-howto" });
    h += gap(ctx, 1);
    h += painter.text(content.offer.payment, MARGIN_X + panelPad, top + h, innerW, { size: sz(ctx, 8), color: BODY, lh: 1.38, what: "offer-payment" });
    return h;
  };
  const qrH = (() => {
    const q = new Painter(p.doc, p.fonts, true);
    return drawQr({ ...ctx, p: q }, 0, 0, qrW).h;
  })();
  const offerH = measureOffer(new Painter(p.doc, p.fonts, true), 0);
  const panelH = Math.max(offerH, qrH) + 2 * panelPad;
  p.box(MARGIN_X, y, CONTENT_W, panelH, { fill: TINT_2, r: 3.2, what: "offer-panel" });
  measureOffer(p, y + panelPad);
  const qr = drawQr(ctx, PAGE_W - MARGIN_X - panelPad - qrW, y + panelPad + Math.max(0, (panelH - 2 * panelPad - qrH) / 2), qrW);
  y += panelH;

  return { bottom: y, qr };
}

// ---------------------------------------------------------------------------
// Композиция B — основная колонка слева, панель предложения справа
// ---------------------------------------------------------------------------

function composeB(ctx: Ctx, footerTop: number): { bottom: number; qr: { box: PdfBox; module: number } } {
  const { p, content } = ctx;
  let y = MARGIN_TOP;
  y += drawHeader(ctx, y) + gap(ctx, 5);

  const sideW = 60;
  const colGap = 7;
  const mainW = CONTENT_W - sideW - colGap;
  const sideX = PAGE_W - MARGIN_X - sideW;
  const top = y;

  // Основная колонка.
  let m = top;
  m += drawTitle(ctx, MARGIN_X, m, mainW, 19.5) + gap(ctx, 3);
  m += p.text(content.lead, MARGIN_X, m, mainW, { size: sz(ctx, 9.4), color: BODY, lh: 1.45, what: "lead" });
  m += gap(ctx, 5.5);
  m += sectionLabel(ctx, "Как это работает", MARGIN_X, m, mainW) + gap(ctx, 2.4);
  const numSize = 6 * ctx.k;
  content.steps.forEach((step, index) => {
    if (index > 0) m += gap(ctx, 2.6);
    p.number(MARGIN_X, m, numSize, String(index + 1));
    const tx = MARGIN_X + numSize + 3;
    const tw = mainW - numSize - 3;
    const start = m;
    let h = p.text(step.title, tx, m, tw, { size: sz(ctx, 9.2), weight: "extrabold", lh: 1.28, what: "step-title" });
    h += p.text(step.text, tx, m + h, tw, { size: sz(ctx, 8.2), color: BODY, lh: 1.38, what: "step" });
    m = start + Math.max(h, numSize);
  });
  m += gap(ctx, 2.4);
  m += p.text(content.stepsNote, MARGIN_X, m, mainW, { size: sz(ctx, 7.9), color: BODY, lh: 1.4, what: "steps-note" });
  m += gap(ctx, 5.5);
  m += drawBenefits(ctx, MARGIN_X, m, mainW);
  m += gap(ctx, 5.5);
  m += drawJournals(ctx, MARGIN_X, m, mainW);

  // Панель предложения справа — до футера.
  const pad = 4.2 * ctx.k;
  const innerW = sideW - 2 * pad;
  const panelBottom = footerTop - gap(ctx, 5);
  p.box(sideX, top, sideW, panelBottom - top, { fill: TINT_2, r: 3.2, what: "offer-panel" });
  let s = top + pad;
  s += p.text(content.offer.title.toUpperCase(), sideX + pad, s, innerW, {
    size: sz(ctx, 7),
    weight: "extrabold",
    color: ACCENT_DEEP,
    lh: 1.3,
    charSpace: 0.3,
    what: "offer-label",
  });
  s += gap(ctx, 3);
  const rowBlock = (row: ProposalOfferRow) => {
    s += p.text(row.title, sideX + pad, s, innerW, { size: sz(ctx, 9.2), weight: "extrabold", lh: 1.28, what: "offer-title" });
    s += gap(ctx, 1.2);
    if (row.oldPrice) {
      s += p.rich([{ text: row.oldPrice, weight: "semibold", color: MUTED, strike: true }], sideX + pad, s, innerW, sz(ctx, 9.5), 1.2, "old-price");
    }
    s += priceLine(ctx, row.price, row.unit, sideX + pad, s, innerW, sz(ctx, 18));
    if (row.badge) {
      s += gap(ctx, 1.4);
      const bs = sz(ctx, 7.2);
      const bw = Math.min(innerW, p.width(row.badge, "extrabold", bs) + 3.6);
      const bh = bs * PT * 1.7;
      p.box(sideX + pad, s, bw, bh, { fill: ACCENT_DEEP, r: bh / 2, what: "badge" });
      p.text(row.badge, sideX + pad, s, bw, { size: bs, weight: "extrabold", color: WHITE, align: "center", lh: 1.7, what: "badge-text" });
      s += bh;
    }
    s += gap(ctx, 1.4);
    s += p.text(row.text, sideX + pad, s, innerW, { size: sz(ctx, 7.8), color: BODY, lh: 1.36, what: "offer-text" });
  };
  rowBlock(content.offer.rows[0]);
  s += gap(ctx, 3);
  p.line(sideX + pad, s, sideX + sideW - pad, s, LINE, 0.3);
  s += gap(ctx, 3);
  rowBlock(content.offer.rows[1]);
  for (const note of content.offer.notes) {
    s += gap(ctx, 2);
    s += p.text(note, sideX + pad, s, innerW, { size: sz(ctx, 7.6), weight: "semibold", color: ACCENT_DEEP, lh: 1.36, what: "offer-note" });
  }
  s += gap(ctx, 4);
  const qrW = Math.min(innerW, 40 * ctx.k);
  const qr = drawQr(ctx, sideX + (sideW - qrW) / 2, s, qrW);
  s += qr.h + gap(ctx, 3);
  s += p.text(content.offer.howTo, sideX + pad, s, innerW, { size: sz(ctx, 8), weight: "extrabold", lh: 1.36, what: "offer-howto" });
  s += gap(ctx, 1);
  s += p.text(content.offer.payment, sideX + pad, s, innerW, { size: sz(ctx, 7.6), color: BODY, lh: 1.36, what: "offer-payment" });
  s += pad;

  return { bottom: Math.max(m, s, panelBottom), qr };
}

// ---------------------------------------------------------------------------

function attempt(content: ProposalContent, k: number, layout: ProposalPdfLayout, dry: boolean) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const fonts = registerProposalFonts(doc);
  const painter = new Painter(doc, fonts, dry);
  const ctx: Ctx = { p: painter, k, content };
  const footerH = drawFooter({ ...ctx, p: new Painter(doc, fonts, true) }, PAGE_H - MARGIN_BOTTOM, layout === "a");
  const footerTop = PAGE_H - MARGIN_BOTTOM - footerH;
  const body = layout === "b" ? composeB(ctx, footerTop) : composeA(ctx);
  if (!dry) drawFooter(ctx, PAGE_H - MARGIN_BOTTOM, layout === "a");
  // Между телом и футером — не меньше 4 мм воздуха.
  const fits = body.bottom <= footerTop - 4 + 1e-6;
  return { doc, painter, fits, body, footerTop };
}

export function renderProposalPdfDocument(
  content: ProposalContent,
  options: { layout?: ProposalPdfLayout } = {},
): ProposalPdfRender {
  const layout = options.layout ?? "a";
  let scale: number | null = null;
  if (attempt(content, 1, layout, true).fits) scale = 1;
  else if (attempt(content, MIN_SCALE, layout, true).fits) {
    let lo = MIN_SCALE;
    let hi = 1;
    while (hi - lo > SCALE_STEP) {
      const mid = (lo + hi) / 2;
      if (attempt(content, mid, layout, true).fits) lo = mid;
      else hi = mid;
    }
    scale = Math.floor(lo * 1000) / 1000;
  }
  if (scale === null) throw new Error(`КП не помещается на лист A4 (сфера ${content.sphere})`);
  const real = attempt(content, scale, layout, false);
  return {
    buffer: Buffer.from(real.doc.output("arraybuffer")),
    pages: real.doc.getNumberOfPages(),
    bounds: real.painter.bounds,
    scale,
    qr: { url: content.offer.ctaUrl, box: real.body.qr.box, module: real.body.qr.module },
  };
}
