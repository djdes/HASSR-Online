import {
  BRAND_COLORS as C,
  BRAND_CONTENT_BOTTOM,
  BRAND_CONTENT_TOP,
  BRAND_PAGE,
  PT,
  SECTION_SIZE,
  avatar,
  brandSeller,
  checkBadge,
  contactIcon,
  createBrandPdf,
  drawFramedQr,
  footerCard,
  letterhead,
  routeRail,
  setText,
  type BrandPdf,
  type RGB,
  type TextStyle,
} from "@/lib/brand-docs/pdf-kit";
import type { ProposalWeight } from "@/lib/proposal/pdf-font";

import type { ProposalContent } from "./content";
import type { ProposalDesign, ProposalDesignCell } from "./design";

/**
 * КП на одном листе A4 в стиле шаблонов «WeSetup - шаблоны (без покупателя,
 * новый стиль)» (брендбук сетап 1.0, правка 2026-11-07): белый бланк кита
 * `brand-docs`, строка «Коммерческое предложение · тариф» с датой справа,
 * крупный заголовок слева, «Стоимость за одну точку» тонкими линиями, «Что
 * входит» и «Порядок подключения» (маршрут) рядом, подпись отправителя и QR в рамке.
 * Без прописных с разрядкой; текст абзацев — по ширине; крайние колонки
 * таблиц стоят ровно по краям набора.
 *
 * Вёрстка — «измерить, потом рисовать»: при длинном названии компании или
 * «Премиуме» (две доп. строки) отступы, затем высота строк и кегли
 * уменьшаются ступенями (`scale`), пока лист не поместится. Не влезло даже
 * на самой мелкой ступени — ошибка, а не обрезанный текст.
 *
 * Всё нарисованное записывается в `bounds` — тест проверяет, что ничего не
 * выходит за поля и лист один.
 */

export const PAGE_W = BRAND_PAGE.w;
export const PAGE_H = BRAND_PAGE.h;
export const MARGIN_X = BRAND_PAGE.side;
/** Верх шапки и низ подвала. */
export const MARGIN_TOP = 5;
export const MARGIN_BOTTOM = 5;

export type PdfBox = { x0: number; y0: number; x1: number; y1: number; what: string };

export type ProposalPdfRender = {
  buffer: Buffer;
  pages: number;
  bounds: PdfBox[];
  /** Ступень плотности, на которой всё поместилось (1 — как в образце). */
  scale: number;
  qr: { url: string; box: PdfBox; module: number };
};

const MIN_SCALE = 0.3;
const X = BRAND_PAGE.side;
const W = BRAND_PAGE.contentW;
/** Поле ячейки таблицы (как 110 twips в Word-шаблоне). */
const PAD = 1.9;
/** Внешняя рамка QR; сам код внутри — не меньше 15 мм. */
const QR_FRAME = 18.2;
/** Кегли листа: заголовок, «для …», раздел, вводный текст, основной, подписи. */
const SIZE = { title: 22, forLine: 16, h: SECTION_SIZE, lead: 10.5, body: 9.5, small: 7.5 } as const;

type Ctx = {
  pdf: BrandPdf;
  d: ProposalDesign;
  content: ProposalContent;
  /** Плотность: отступы × s, строки таблиц и кегли — мягче. */
  s: number;
  draw: boolean;
  bounds: PdfBox[];
};

const gap = (ctx: Ctx, mm: number) => mm * ctx.s;
const rowH = (ctx: Ctx, mm: number) => mm * (0.82 + 0.18 * ctx.s);
const fs = (ctx: Ctx, pt: number) => pt * (0.9 + 0.1 * ctx.s);

function mark(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, what: string) {
  ctx.bounds.push({ x0, y0, x1, y1, what });
}

function style(ctx: Ctx, size: number, weight: ProposalWeight = "regular", color: RGB = C.ink): TextStyle {
  return { size: fs(ctx, size), weight, color };
}

/** Базовая линия текста, вертикально по центру полосы высотой h. */
function middle(top: number, h: number, size: number): number {
  return top + h / 2 + size * PT * 0.34;
}

function text(ctx: Ctx, value: string, x: number, y: number, st: TextStyle, align: "left" | "center" | "right" = "left", what = "text") {
  setText(ctx.pdf, st);
  const w = ctx.pdf.doc.getTextWidth(value);
  const x0 = align === "left" ? x : align === "center" ? x - w / 2 : x - w;
  if (ctx.draw) ctx.pdf.doc.text(value, x0, y);
  mark(ctx, x0, y - st.size * PT * 0.8, x0 + w, y + st.size * PT * 0.25, what);
}

function wrap(ctx: Ctx, value: string, width: number, st: TextStyle): string[] {
  setText(ctx.pdf, st);
  return ctx.pdf.doc.splitTextToSize(value, width) as string[];
}

/**
 * Абзац по ширине: слова каждой строки, кроме последней, растянуты до
 * правого края (word spacing jsPDF не работает со шрифтами Identity-H —
 * ставим слова сами). Возвращает базовую линию последней строки.
 */
function justified(ctx: Ctx, value: string, x: number, firstBase: number, width: number, st: TextStyle, lineGap: number, what: string): number {
  const rows = wrap(ctx, value, width, st);
  let base = firstBase;
  rows.forEach((row, index) => {
    if (index > 0) base += lineGap;
    const words = row.split(/ +/).filter(Boolean);
    if (index === rows.length - 1 || words.length < 2) {
      text(ctx, row, x, base, st, "left", what);
      return;
    }
    setText(ctx.pdf, st);
    const widths = words.map((word) => ctx.pdf.doc.getTextWidth(word));
    const space = (width - widths.reduce((sum, w) => sum + w, 0)) / (words.length - 1);
    let cursor = x;
    words.forEach((word, k) => {
      text(ctx, word, cursor, base, st, "left", what);
      cursor += widths[k] + space;
    });
  });
  return base;
}

function fillRect(ctx: Ctx, x: number, y: number, w: number, h: number, color: RGB, what = "fill") {
  if (ctx.draw) {
    ctx.pdf.doc.setFillColor(...color);
    ctx.pdf.doc.rect(x, y, w, h, "F");
  }
  mark(ctx, x, y, x + w, y + h, what);
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color: RGB, width = 0.2) {
  if (!ctx.draw) return;
  ctx.pdf.doc.setDrawColor(...color);
  ctx.pdf.doc.setLineWidth(width);
  ctx.pdf.doc.line(x1, y1, x2, y2);
}

// ───────────────────────────── блоки ─────────────────────────────

/** Заголовок раздела — тем же начертанием, что приветствие. Возвращает высоту с отступом под ним. */
function heading(ctx: Ctx, value: string, x: number, y: number): number {
  const h = fs(ctx, SIZE.h) * PT * 1.3;
  text(ctx, value, x, y + h * 0.78, style(ctx, SIZE.h, "semibold"), "left", "heading");
  return h + gap(ctx, 2.4);
}

/** «Коммерческое предложение · тариф «…»» и дата, заголовок, «для …», адресат. */
function titleBlock(ctx: Ctx, y: number): number {
  const { d, content } = ctx;
  const meta = style(ctx, SIZE.body, "regular", C.muted);
  let cursor = y + meta.size * PT * 0.95;
  text(ctx, `${d.title}  ·  тариф «${d.planName}»`, X, cursor, meta, "left", "eyebrow");
  text(ctx, `${content.dateLabel}${String.fromCharCode(0xa0)}г.`, X + W, cursor, meta, "right", "date");

  const title = style(ctx, SIZE.title, "semibold");
  cursor += gap(ctx, 5) + title.size * PT * 0.95;
  for (const row of wrap(ctx, content.titleLead, W, title)) {
    text(ctx, row, X, cursor, title, "left", "title");
    cursor += title.size * PT * 1.15;
  }
  cursor -= title.size * PT * 1.15;
  if (d.forLine) {
    const st = style(ctx, SIZE.forLine, "semibold", C.indigoDeep);
    cursor += gap(ctx, 1.2);
    for (const row of wrap(ctx, d.forLine, W, st)) {
      cursor += st.size * PT * 1.2;
      text(ctx, row, X, cursor, st, "left", "for-line");
    }
  }
  if (d.addressee) {
    cursor += gap(ctx, 1) + meta.size * PT * 1.5;
    text(ctx, d.addressee, X, cursor, meta, "left", "addressee");
  }
  return cursor + gap(ctx, 1) - y;
}

/** Приветствие и вводный абзац по ширине. */
function greetingBlock(ctx: Ctx, y: number): number {
  const { d } = ctx;
  const greet = style(ctx, SIZE.h, "semibold");
  let cursor = y + greet.size * PT * 0.95;
  text(ctx, d.greeting, X, cursor, greet, "left", "greeting");
  const lead = style(ctx, SIZE.lead, "regular", C.ink2);
  const lineGap = lead.size * PT * 1.5;
  cursor = justified(ctx, d.lead.join(" "), X, cursor + gap(ctx, 1.4) + lineGap, W, lead, lineGap, "lead");
  return cursor + gap(ctx, 1) - y;
}

/** «Стоимость за одну точку»: подписи колонок над тёмной линией, строки — тонкими линиями, без заливок. */
function priceTable(ctx: Ctx, y: number): number {
  const { d } = ctx;
  const cols = [74, 32, 32, W - 138];
  const xs = cols.reduce<number[]>((acc, w, i) => [...acc, acc[i] + w], [X]);
  const headH = rowH(ctx, 6.4);
  const bodyH = rowH(ctx, 9);
  const extraH = rowH(ctx, 8.2);
  const cap = style(ctx, SIZE.small, "regular", C.muted);
  /** Правый край текста колонки: внутренние — с полем, последняя — по краю набора. */
  const right = (i: number) => (i === 3 ? X + W : xs[i + 1] - PAD);
  let cursor = y;

  const headBase = cursor + headH - 1.8;
  d.price.columns.forEach((label, i) => text(ctx, label, i === 0 ? X : right(i), headBase, cap, i === 0 ? "left" : "right", "price-head"));
  cursor += headH;
  line(ctx, X, cursor, X + W, cursor, C.ink, 0.3);

  const row = (cells: [string, string, string, string], year: boolean) => {
    const base = middle(cursor, bodyH, fs(ctx, SIZE.body));
    text(ctx, cells[0], X, base, style(ctx, SIZE.body, year ? "semibold" : "regular"), "left", "price-cell");
    text(ctx, cells[1], right(1), base, style(ctx, SIZE.body, year ? "semibold" : "regular", year ? C.indigoDeep : C.ink), "right", "price-cell");
    text(ctx, cells[2], right(2), base, style(ctx, SIZE.body, year ? "semibold" : "regular", year ? C.indigoDeep : C.faint), "right", "price-cell");
    text(ctx, cells[3], right(3), base, style(ctx, SIZE.body, "semibold"), "right", "price-cell");
    cursor += bodyH;
    line(ctx, X, cursor, X + W, cursor, C.border);
  };
  row([d.price.month.label, d.price.month.monthly, d.price.month.saving, d.price.month.total], false);
  row([d.price.year.label, d.price.year.monthly, d.price.year.saving, d.price.year.total], true);
  for (const extra of d.price.extras) {
    const base = middle(cursor, extraH, fs(ctx, SIZE.body));
    text(ctx, extra.label, X, base, style(ctx, SIZE.body, "regular", C.muted), "left", "price-extra");
    text(ctx, extra.price, X + W, base, style(ctx, SIZE.body, "regular", C.ink2), "right", "price-extra");
    cursor += extraH;
    line(ctx, X, cursor, X + W, cursor, C.border);
  }
  if (ctx.draw) line(ctx, X, cursor, X + W, cursor, C.border2);
  mark(ctx, X, y, X + W, cursor, "price-table");

  const small = style(ctx, SIZE.small, "regular", C.muted);
  const lineGap = small.size * PT * 1.45;
  const notes = [d.price.note, d.price.discountNote].filter((item): item is string => Boolean(item));
  let base = cursor + gap(ctx, 1.6);
  for (const paragraph of notes) base = justified(ctx, paragraph, X, base + lineGap, W, small, lineGap, "price-note");
  return base + gap(ctx, 1) - y;
}

function valueCell(ctx: Ctx, cell: ProposalDesignCell, cx: number, top: number, h: number) {
  if (cell.kind === "yes") {
    if (ctx.draw) checkBadge(ctx.pdf, cx, top + h / 2, Math.min(3.6, h * 0.66));
    mark(ctx, cx - 1.7, top + h / 2 - 1.7, cx + 1.7, top + h / 2 + 1.7, "check");
    return;
  }
  const st = cell.kind === "no" ? style(ctx, SIZE.body, "regular", C.faint) : style(ctx, SIZE.body);
  text(ctx, cell.kind === "no" ? "—" : cell.text, cx, middle(top, h, st.size), st, "center", "compare-cell");
}

/** «Что входит»: два тарифа, текущий — светлая колонка с индиго-чертой под названием. */
function comparisonTable(ctx: Ctx, x: number, y: number, width: number): number {
  const { d } = ctx;
  const colW = 28;
  const xs = [x, x + width - 2 * colW, x + width - colW, x + width];
  const headH = rowH(ctx, 7);
  const bodyH = rowH(ctx, 5.9);
  const priceH = rowH(ctx, 7);
  const current = d.comparison.current;
  const activeX = xs[current + 1];
  const total = headH + bodyH * d.comparison.rows.length + priceH;
  fillRect(ctx, activeX, y, colW, total, C.tint, "compare-tint");
  let cursor = y;

  text(ctx, "Тариф", x, cursor + headH - 1.8, style(ctx, SIZE.small, "regular", C.muted), "left", "compare-head-text");
  d.comparison.columns.forEach((name, i) => {
    const active = i === current;
    text(ctx, name, xs[i + 1] + colW / 2, middle(cursor, headH, fs(ctx, SIZE.body)), style(ctx, SIZE.body, "semibold", active ? C.indigoDeep : C.ink), "center", "compare-head-text");
  });
  cursor += headH;
  line(ctx, x, cursor, x + width, cursor, C.ink, 0.3);
  line(ctx, activeX, cursor, activeX + colW, cursor, C.indigo, 0.8);

  for (const rowData of d.comparison.rows) {
    text(ctx, rowData.label, x, middle(cursor, bodyH, fs(ctx, SIZE.body)), style(ctx, SIZE.body, "regular", C.ink2), "left", "compare-label");
    rowData.cells.forEach((cell, i) => valueCell(ctx, cell, xs[i + 1] + colW / 2, cursor, bodyH));
    cursor += bodyH;
    line(ctx, x, cursor, x + width, cursor, C.border);
  }

  line(ctx, x, cursor, x + width, cursor, C.ink, 0.3);
  text(ctx, d.comparison.priceRow.label, x, middle(cursor, priceH, fs(ctx, SIZE.body)), style(ctx, SIZE.body, "semibold"), "left", "compare-price-label");
  d.comparison.priceRow.values.forEach((value, i) => {
    text(ctx, value, xs[i + 1] + colW / 2, middle(cursor, priceH, fs(ctx, SIZE.body)), style(ctx, SIZE.body, "semibold", i === current ? C.indigoDeep : C.ink), "center", "compare-price-value");
  });
  cursor += priceH;
  line(ctx, x, cursor, x + width, cursor, C.border2);
  mark(ctx, x, y, x + width, cursor, "compare-table");
  return cursor - y;
}

/** «Порядок подключения» — фирменный маршрут: пунктир с кольцами, первое кольцо залито. */
function timeline(ctx: Ctx, x: number, y: number, width: number): number {
  const { d } = ctx;
  const step = rowH(ctx, 14);
  const nodeX = x + 1.6;
  const tx = x + 5.6;
  const cap = fs(ctx, SIZE.small);
  const nodes = d.steps.items.map((_, i) => y + 1.6 + step * i);
  if (ctx.draw) routeRail(ctx.pdf, nodeX, nodes);
  nodes.forEach((ny) => mark(ctx, nodeX - 1.6, ny - 1.6, nodeX + 1.6, ny + 1.6, "node"));
  d.steps.items.forEach((item, i) => {
    const capBase = nodes[i] + cap * PT * 0.34;
    text(ctx, `Шаг ${i + 1}`, tx, capBase, style(ctx, SIZE.small, "regular", i === 0 ? C.indigo : C.muted), "left", "step-num");
    const titleBase = capBase + fs(ctx, SIZE.body) * PT * 1.45;
    text(ctx, item.title, tx, titleBase, style(ctx, SIZE.body, "semibold"), "left", "step-title");
    const sub = style(ctx, SIZE.body, "regular", C.muted);
    wrap(ctx, item.text, width - (tx - x), sub).forEach((rowText, k) => {
      text(ctx, rowText, tx, titleBase + sub.size * PT * 1.4 * (k + 1), sub, "left", "step-text");
    });
  });
  return nodes[nodes.length - 1] - y + step * 0.75;
}

/** Подпись отправителя, контакты и QR в рамке — три колонки от одной тонкой линии. */
function signatureRow(ctx: Ctx, y: number): { h: number; qr: { box: PdfBox; module: number } } {
  const { d } = ctx;
  const cols = [13.5, 62, 56];
  const xs = cols.reduce<number[]>((acc, w, i) => [...acc, acc[i] + w], [X]);
  line(ctx, X, y, X + W, y, C.border2);
  const top = y + gap(ctx, 4.2);

  const r = 5.5;
  if (ctx.draw) avatar(ctx.pdf, X + r, top + r, r, d.sender.initials);
  mark(ctx, X, top, X + 2 * r, top + 2 * r, "avatar");

  const tx = xs[1] + 2.8;
  const textW = xs[2] - tx - 3;
  const muted = style(ctx, SIZE.body, "regular", C.muted);
  let cursor = top + muted.size * PT * 0.95;
  text(ctx, "С уважением,", tx, cursor, muted, "left", "regards");
  // Имя не заходит в колонку контактов: длинное — в две строки.
  const nameStyle = style(ctx, SIZE.h, "semibold");
  wrap(ctx, d.sender.displayName, textW, nameStyle)
    .slice(0, 2)
    .forEach((row, index) => {
      cursor += nameStyle.size * PT * (index === 0 ? 1.45 : 1.2);
      text(ctx, row, tx, cursor, nameStyle, "left", "sender-name");
    });
  for (const row of wrap(ctx, d.sender.position, textW, muted).slice(0, 2)) {
    cursor += muted.size * PT * 1.4;
    text(ctx, row, tx, cursor, muted, "left", "sender-position");
  }
  if (d.sender.signature) {
    cursor += 8;
    line(ctx, tx, cursor + 0.6, tx + 36, cursor + 0.6, C.faint, 0.25);
    cursor += fs(ctx, SIZE.body) * PT * 1.6;
    text(ctx, d.sender.signature, tx, cursor, style(ctx, SIZE.body), "left", "sender-signature");
  }
  const leftBottom = cursor + 1;

  const cx = xs[2] + 3.5;
  const body = style(ctx, SIZE.body, "regular", C.ink2);
  let c = top + body.size * PT * 0.95;
  text(ctx, d.contact.lines[0], cx, c, style(ctx, SIZE.body, "semibold"), "left", "contact-text");
  c += body.size * PT * 1.45;
  text(ctx, d.contact.lines[1], cx, c, body, "left", "contact-text");
  for (const [kind, value] of [
    ["phone", d.contact.phone],
    ["mail", d.contact.email],
  ] as const) {
    if (!value) continue;
    c += body.size * PT * 1.6;
    if (ctx.draw) contactIcon(ctx.pdf, kind, cx, c - 2.6, 3);
    text(ctx, value, cx + 5, c, body, "left", "contact-value");
  }

  const qx = X + W - QR_FRAME;
  let qr = { module: (QR_FRAME * 0.85) / 29, code: { x: qx, y: top, size: QR_FRAME * 0.85 } };
  if (ctx.draw) qr = drawFramedQr(ctx.pdf, d.contact.qrUrl, { x: qx, y: top, size: QR_FRAME }, { ecc: "M" });
  mark(ctx, qx, top, qx + QR_FRAME, top + QR_FRAME, "qr");
  const capBase = top + QR_FRAME + gap(ctx, 1.4) + fs(ctx, SIZE.small) * PT;
  text(ctx, d.contact.qrCaption, X + W, capBase, style(ctx, SIZE.small, "regular", C.muted), "right", "qr-caption");

  const bottom = Math.max(leftBottom, c + 1.5, capBase + 1, top + 2 * r);
  const code = qr.code;
  return {
    h: bottom - y,
    qr: { box: { x0: code.x, y0: code.y, x1: code.x + code.size, y1: code.y + code.size, what: "qr-window" }, module: qr.module },
  };
}

// ───────────────────────────── сборка ─────────────────────────────

function compose(ctx: Ctx): { bottom: number; qr: { box: PdfBox; module: number } } {
  let y = BRAND_CONTENT_TOP - 1;
  y += titleBlock(ctx, y);
  y += gap(ctx, 7);
  y += greetingBlock(ctx, y);
  y += gap(ctx, 6);
  y += heading(ctx, ctx.d.price.title, X, y);
  y += priceTable(ctx, y);
  y += gap(ctx, 5.5);

  const leftW = 109;
  const rightX = X + leftW + 9;
  const rightW = X + W - rightX;
  const headH = heading(ctx, ctx.d.comparison.title, X, y);
  heading(ctx, ctx.d.steps.title, rightX, y);
  y += headH;
  const leftH = comparisonTable(ctx, X, y, leftW);
  const rightH = timeline(ctx, rightX, y + 1.2, rightW);
  y += Math.max(leftH, rightH + 1.2);
  y += gap(ctx, 7);

  const sign = signatureRow(ctx, y);
  y += sign.h + gap(ctx, 4);
  const small = style(ctx, SIZE.small, "regular", C.faint);
  for (const row of wrap(ctx, ctx.d.disclaimer, W, small)) {
    y += small.size * PT * 1.35;
    text(ctx, row, X, y, small, "left", "disclaimer");
  }
  return { bottom: y + 1, qr: sign.qr };
}

export function renderProposalPdfDocument(content: ProposalContent): ProposalPdfRender {
  const d = content.design;
  const measure = createBrandPdf({ title: "Коммерческое предложение WeSetup" });
  const fits = (s: number) => compose({ pdf: measure, d, content, s, draw: false, bounds: [] }).bottom <= BRAND_CONTENT_BOTTOM;
  let scale: number | null = null;
  if (fits(1)) scale = 1;
  else if (fits(MIN_SCALE)) {
    let lo = MIN_SCALE;
    let hi = 1;
    while (hi - lo > 0.01) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    scale = Math.floor(lo * 100) / 100;
  }
  if (scale === null) throw new Error(`КП не помещается на лист A4 (сфера ${content.sphere})`);

  const pdf = createBrandPdf({
    title: `Коммерческое предложение WeSetup — ${d.planName}`,
    subject: "Электронные журналы СанПиН и ХАССП",
  });
  const ctx: Ctx = { pdf, d, content, s: scale, draw: true, bounds: [] };
  const seller = brandSeller({ ...d.seller, site: "wesetup.ru" });
  letterhead(pdf, seller);
  footerCard(pdf, seller);
  mark(ctx, X, MARGIN_TOP, X + W, MARGIN_TOP + 26, "letterhead");
  mark(ctx, X, PAGE_H - MARGIN_BOTTOM - 7, X + W, PAGE_H - MARGIN_BOTTOM, "footer");
  const body = compose(ctx);
  return {
    buffer: Buffer.from(pdf.doc.output("arraybuffer")),
    pages: pdf.doc.getNumberOfPages(),
    bounds: ctx.bounds,
    scale,
    qr: { url: d.contact.qrUrl, box: body.qr.box, module: body.qr.module },
  };
}
