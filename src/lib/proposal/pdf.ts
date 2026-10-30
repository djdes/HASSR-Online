import {
  BRAND_COLORS as C,
  BRAND_CONTENT_BOTTOM,
  BRAND_CONTENT_TOP,
  BRAND_PAGE,
  PT,
  brandSeller,
  checkBadge,
  contactIcon,
  createBrandPdf,
  drawQr,
  footerCard,
  letterhead,
  setText,
  type BrandPdf,
  type RGB,
  type TextStyle,
} from "@/lib/brand-docs/pdf-kit";
import type { ProposalWeight } from "@/lib/proposal/pdf-font";

import type { ProposalContent } from "./content";
import type { ProposalDesign, ProposalDesignCell } from "./design";

/**
 * КП на одном листе A4 в дизайне «WeSetup - КП и счета (новый дизайн)»
 * (2026-10-30): тёмные карточки шапки и подвала (кит `brand-docs`), крупный
 * заголовок «КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ» по центру, «Стоимость за одну точку»,
 * «Что входит» и «Как начать» рядом, подпись отправителя и карточка с QR.
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
/** Верх шапки и низ подвала — края карточек. */
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
const NODE: RGB = [124, 139, 248];
const RAIL: RGB = [201, 207, 245];
const QR_SIZE = 15;

type Ctx = {
  pdf: BrandPdf;
  d: ProposalDesign;
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

function heading(ctx: Ctx, value: string, x: number, y: number): number {
  const h = fs(ctx, 12) * PT * 1.35;
  text(ctx, value, x, y + h * 0.78, style(ctx, 12, "semibold"), "left", "heading");
  return h + gap(ctx, 2.2);
}

function titleBlock(ctx: Ctx, y: number): number {
  const { d } = ctx;
  const cx = X + W / 2;
  let cursor = y;
  // «КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ» разрядкой: ширину считаем с межбуквенным интервалом сами.
  const titleSt = style(ctx, 20, "semibold");
  const title = d.title.toLocaleUpperCase("ru-RU");
  const charSpace = 0.42;
  setText(ctx.pdf, titleSt);
  const tw = ctx.pdf.doc.getTextWidth(title) + charSpace * (Array.from(title).length - 1);
  const base = cursor + titleSt.size * PT * 0.95;
  if (ctx.draw) ctx.pdf.doc.text(title, cx - tw / 2, base, { charSpace });
  mark(ctx, cx - tw / 2, base - titleSt.size * PT * 0.8, cx + tw / 2, base + 1, "title");
  cursor = base + gap(ctx, 3.2);
  if (d.forLine) {
    const st = style(ctx, 12, "semibold", C.indigo);
    for (const row of wrap(ctx, d.forLine, W - 10, st)) {
      cursor += st.size * PT * 1.25;
      text(ctx, row, cx, cursor, st, "center", "for-line");
    }
    cursor += gap(ctx, 1.6);
  }
  const meta = style(ctx, 9.5, "regular", C.muted);
  cursor += meta.size * PT * 1.3;
  text(ctx, d.metaLine, cx, cursor, meta, "center", "meta");
  if (d.addressee) {
    cursor += meta.size * PT * 1.45;
    text(ctx, d.addressee, cx, cursor, style(ctx, 9.5, "regular", C.ink2), "center", "addressee");
  }
  return cursor + gap(ctx, 1.5) - y;
}

function greetingBlock(ctx: Ctx, y: number): number {
  const { d } = ctx;
  const cx = X + W / 2;
  const greet = style(ctx, 12, "semibold");
  let cursor = y + greet.size * PT * 1.1;
  text(ctx, d.greeting, cx, cursor, greet, "center", "greeting");
  const body = style(ctx, 9.5, "regular", C.ink);
  cursor += gap(ctx, 1.4);
  for (const paragraph of d.lead) {
    for (const row of wrap(ctx, paragraph, W - 2, body)) {
      cursor += body.size * PT * 1.45;
      text(ctx, row, cx, cursor, body, "center", "lead");
    }
  }
  return cursor + gap(ctx, 1) - y;
}

/** «Стоимость за одну точку»: тёмная шапка, «Каждый месяц», «Сразу за год», «Дополнительно». */
function priceTable(ctx: Ctx, y: number): number {
  const { d } = ctx;
  const cols = [66, 34, 34, W - 134];
  const xs = cols.reduce<number[]>((acc, w, i) => [...acc, acc[i] + w], [X]);
  const pad = 2.6;
  const headH = rowH(ctx, 8.4);
  const bodyH = rowH(ctx, 8.6);
  const extraH = rowH(ctx, 7.4);
  const body = style(ctx, 9.5);
  let cursor = y;

  fillRect(ctx, X, cursor, W, headH, C.ink, "price-head");
  d.price.columns.forEach((label, i) => {
    const right = i > 0;
    text(ctx, label, right ? xs[i + 1] - pad : xs[i] + pad, middle(cursor, headH, body.size), style(ctx, 9.5, "semibold", C.white), right ? "right" : "left", "price-head-text");
    if (i > 0) line(ctx, xs[i], cursor, xs[i], cursor + headH, [58, 63, 85], 0.2);
  });
  cursor += headH;

  const row = (cells: [string, string, string, string], tint: boolean) => {
    if (tint) fillRect(ctx, X, cursor, W, bodyH, C.tint, "price-tint");
    const base = middle(cursor, bodyH, body.size);
    text(ctx, cells[0], xs[0] + pad, base, style(ctx, 9.5, tint ? "semibold" : "regular"), "left", "price-cell");
    text(ctx, cells[1], xs[2] - pad, base, style(ctx, 9.5, tint ? "semibold" : "regular", tint ? C.indigo : C.ink), "right", "price-cell");
    text(ctx, cells[2], xs[3] - pad, base, style(ctx, 9.5, tint ? "semibold" : "regular", tint ? C.indigo : C.muted), "right", "price-cell");
    text(ctx, cells[3], xs[4] - pad, base, style(ctx, 9.5, "semibold"), "right", "price-cell");
    for (let i = 1; i < 4; i += 1) line(ctx, xs[i], cursor, xs[i], cursor + bodyH, C.border);
    line(ctx, X, cursor + bodyH, X + W, cursor + bodyH, C.border);
    cursor += bodyH;
  };
  row([d.price.month.label, d.price.month.monthly, d.price.month.saving, d.price.month.total], false);
  row([d.price.year.label, d.price.year.monthly, d.price.year.saving, d.price.year.total], true);
  for (const extra of d.price.extras) {
    const base = middle(cursor, extraH, body.size);
    text(ctx, extra.label, xs[0] + pad, base, style(ctx, 9.5, "regular", C.muted), "left", "price-extra");
    text(ctx, extra.price, xs[4] - pad, base, style(ctx, 9.5), "right", "price-extra");
    line(ctx, xs[3], cursor, xs[3], cursor + extraH, C.border);
    line(ctx, X, cursor + extraH, X + W, cursor + extraH, C.border);
    cursor += extraH;
  }
  // Внешняя рамка (верх — тёмная шапка).
  if (ctx.draw) {
    ctx.pdf.doc.setDrawColor(...C.border2);
    ctx.pdf.doc.setLineWidth(0.25);
    ctx.pdf.doc.rect(X, y + headH, W, cursor - y - headH, "S");
  }
  mark(ctx, X, y, X + W, cursor, "price-table");

  const small = style(ctx, 8, "regular", C.muted);
  cursor += gap(ctx, 1.6);
  for (const paragraph of [d.price.note, d.price.discountNote].filter((item): item is string => Boolean(item))) {
    for (const rowText of wrap(ctx, paragraph, W, small)) {
      cursor += small.size * PT * 1.4;
      text(ctx, rowText, X, cursor, small, "left", "price-note");
    }
  }
  return cursor + gap(ctx, 1) - y;
}

function valueCell(ctx: Ctx, cell: ProposalDesignCell, cx: number, top: number, h: number, bold: boolean) {
  if (cell.kind === "yes") {
    if (ctx.draw) checkBadge(ctx.pdf, cx, top + h / 2, Math.min(4, h * 0.72));
    mark(ctx, cx - 1.7, top + h / 2 - 1.7, cx + 1.7, top + h / 2 + 1.7, "check");
    return;
  }
  const st = cell.kind === "no" ? style(ctx, 9.5, "regular", C.faint) : style(ctx, 9.5, bold ? "semibold" : "regular");
  text(ctx, cell.kind === "no" ? "—" : cell.text, cx, middle(top, h, st.size), st, "center", "compare-cell");
}

/** «Что входит»: два тарифа, текущий — индиго. */
function comparisonTable(ctx: Ctx, x: number, y: number, width: number): number {
  const { d } = ctx;
  const first = width - 54;
  const colW = 27;
  const xs = [x, x + first, x + first + colW, x + width];
  const headH = rowH(ctx, 7.6);
  const bodyH = rowH(ctx, 5.75);
  const priceH = rowH(ctx, 6.6);
  const current = d.comparison.current;
  let cursor = y;

  fillRect(ctx, x, cursor, width, headH, C.soft, "compare-head");
  d.comparison.columns.forEach((name, i) => {
    const active = i === current;
    if (active) fillRect(ctx, xs[i + 1], cursor, colW, headH, C.indigo, "compare-head-active");
    text(ctx, name, xs[i + 1] + colW / 2, middle(cursor, headH, fs(ctx, 9.5)), style(ctx, 9.5, "semibold", active ? C.white : C.ink), "center", "compare-head-text");
  });
  cursor += headH;
  line(ctx, x, cursor, x + width, cursor, C.border);

  for (const rowData of d.comparison.rows) {
    fillRect(ctx, xs[current + 1], cursor, colW, bodyH, C.tint, "compare-tint");
    text(ctx, rowData.label, x + 2.4, middle(cursor, bodyH, fs(ctx, 9.5)), style(ctx, 9.5), "left", "compare-label");
    rowData.cells.forEach((cell, i) => valueCell(ctx, cell, xs[i + 1] + colW / 2, cursor, bodyH, false));
    cursor += bodyH;
    line(ctx, x, cursor, x + width, cursor, C.border);
  }

  fillRect(ctx, x, cursor, width, priceH, C.soft, "compare-price");
  fillRect(ctx, xs[current + 1], cursor, colW, priceH, C.tint2, "compare-price-active");
  text(ctx, d.comparison.priceRow.label, x + 2.4, middle(cursor, priceH, fs(ctx, 9.5)), style(ctx, 9.5), "left", "compare-price-label");
  d.comparison.priceRow.values.forEach((value, i) => {
    text(ctx, value, xs[i + 1] + colW / 2, middle(cursor, priceH, fs(ctx, 9.5)), style(ctx, 9.5, "semibold", i === current ? C.indigo : C.ink), "center", "compare-price-value");
  });
  cursor += priceH;

  if (ctx.draw) {
    ctx.pdf.doc.setDrawColor(...C.border2);
    ctx.pdf.doc.setLineWidth(0.25);
    ctx.pdf.doc.rect(x, y, width, cursor - y, "S");
    for (const vx of [xs[1], xs[2]]) line(ctx, vx, y, vx, cursor, C.border);
  }
  mark(ctx, x, y, x + width, cursor, "compare-table");
  return cursor - y;
}

/** «Как начать»: вертикальная линия с полыми кружками. */
function timeline(ctx: Ctx, x: number, y: number, width: number): number {
  const { d } = ctx;
  const step = rowH(ctx, 14);
  const nodeX = x + 2.6;
  const firstNode = y + 3.2;
  const lastNode = y + 3.2 + step * (d.steps.items.length - 1);
  line(ctx, nodeX, firstNode, nodeX, lastNode, RAIL, 0.35);
  d.steps.items.forEach((item, i) => {
    const ny = firstNode + step * i;
    if (ctx.draw) {
      ctx.pdf.doc.setFillColor(...C.white);
      ctx.pdf.doc.setDrawColor(...NODE);
      ctx.pdf.doc.setLineWidth(0.45);
      ctx.pdf.doc.circle(nodeX, ny, 1.35, "FD");
    }
    mark(ctx, nodeX - 1.6, ny - 1.6, nodeX + 1.6, ny + 1.6, "node");
    const base = ny + fs(ctx, 9.5) * PT * 0.35;
    text(ctx, String(i + 1), x + 8.4, base, style(ctx, 9.5, "semibold", NODE), "center", "step-num");
    const tx = x + 13.2;
    text(ctx, item.title, tx, base, style(ctx, 9.5, "semibold"), "left", "step-title");
    const sub = style(ctx, 9.5, "regular", C.muted);
    wrap(ctx, item.text, width - 13.2, sub).forEach((rowText, k) => {
      text(ctx, rowText, tx, base + sub.size * PT * 1.45 * (k + 1), sub, "left", "step-text");
    });
  });
  return lastNode - y + step * 0.6;
}

/** Подпись отправителя слева и карточка «Есть вопросы?» с QR справа. */
function signatureRow(ctx: Ctx, y: number): { h: number; qr: { box: PdfBox; module: number } } {
  const { d } = ctx;
  const cardX = X + 82.8;
  const cardW = W - 82.8;
  const cardH = Math.max(rowH(ctx, 27.5), QR_SIZE + 10);
  fillRect(ctx, cardX, y, cardW, cardH, C.tint, "contact-card");

  // Аватар с инициалами.
  const ax = X + 5.8;
  const ay = y + 8.2;
  if (ctx.draw) {
    ctx.pdf.doc.setFillColor(...C.ink);
    ctx.pdf.doc.setDrawColor(...NODE);
    ctx.pdf.doc.setLineWidth(0.5);
    ctx.pdf.doc.circle(ax, ay, 5.4, "FD");
  }
  mark(ctx, ax - 5.6, ay - 5.6, ax + 5.6, ay + 5.6, "avatar");
  text(ctx, d.sender.initials, ax, ay + 1.3, style(ctx, 10, "semibold", C.lilacText), "center", "avatar-text");

  const tx = X + 15.6;
  const textW = cardX - tx - 4;
  let cursor = y + 4.6;
  text(ctx, "С уважением,", tx, cursor, style(ctx, 9.5, "regular", C.muted), "left", "regards");
  cursor += fs(ctx, 12) * PT * 1.55;
  text(ctx, d.sender.displayName, tx, cursor, style(ctx, 12, "semibold"), "left", "sender-name");
  const muted = style(ctx, 9.5, "regular", C.muted);
  for (const row of wrap(ctx, d.sender.position, textW, muted).slice(0, 2)) {
    cursor += muted.size * PT * 1.4;
    text(ctx, row, tx, cursor, muted, "left", "sender-position");
  }
  if (d.sender.signature) {
    cursor += 7;
    line(ctx, tx, cursor + 0.6, tx + 28, cursor + 0.6, C.faint, 0.25);
    text(ctx, d.sender.signature, tx + 30, cursor, style(ctx, 9.5), "left", "sender-signature");
  }

  // Карточка: текст, телефон, почта и QR.
  const qrX = cardX + cardW - QR_SIZE - 12;
  const qrY = y + 4;
  const textX = cardX + 5.6;
  let c = y + 6.4;
  const body = style(ctx, 9.5);
  text(ctx, d.contact.lines[0], textX, c, body, "left", "contact-text");
  c += body.size * PT * 1.4;
  text(ctx, d.contact.lines[1], textX, c, body, "left", "contact-text");
  for (const [kind, value] of [
    ["phone", d.contact.phone],
    ["mail", d.contact.email],
  ] as const) {
    if (!value) continue;
    c += body.size * PT * 1.6;
    if (ctx.draw) contactIcon(ctx.pdf, kind, textX, c - 2.7, 3.2);
    text(ctx, value, textX + 5, c, body, "left", "contact-value");
  }
  let qrModule = QR_SIZE / 29;
  if (ctx.draw) qrModule = drawQr(ctx.pdf, d.contact.qrUrl, { x: qrX, y: qrY, size: QR_SIZE }, { ecc: "M" }).module;
  mark(ctx, qrX, qrY, qrX + QR_SIZE, qrY + QR_SIZE, "qr");
  text(ctx, d.contact.qrCaption, qrX + QR_SIZE / 2, qrY + QR_SIZE + 4, style(ctx, 8, "regular", C.muted), "center", "qr-caption");
  return { h: cardH, qr: { box: { x0: qrX, y0: qrY, x1: qrX + QR_SIZE, y1: qrY + QR_SIZE, what: "qr-window" }, module: qrModule } };
}

// ───────────────────────────── сборка ─────────────────────────────

function compose(ctx: Ctx): { bottom: number; qr: { box: PdfBox; module: number } } {
  let y = BRAND_CONTENT_TOP - 1;
  y += titleBlock(ctx, y);
  y += gap(ctx, 6);
  y += greetingBlock(ctx, y);
  y += gap(ctx, 6.5);
  y += heading(ctx, ctx.d.price.title, X, y);
  y += priceTable(ctx, y);
  y += gap(ctx, 5.5);

  const leftW = 112;
  const rightX = X + leftW + 7;
  const rightW = X + W - rightX;
  const headH = heading(ctx, ctx.d.comparison.title, X, y);
  heading(ctx, ctx.d.steps.title, rightX, y);
  y += headH;
  const leftH = comparisonTable(ctx, X, y, leftW);
  const rightH = timeline(ctx, rightX, y, rightW);
  y += Math.max(leftH, rightH);
  y += gap(ctx, 7);

  const sign = signatureRow(ctx, y);
  y += sign.h + gap(ctx, 4.2);
  const small = style(ctx, 8, "regular", C.muted);
  for (const row of wrap(ctx, ctx.d.disclaimer, W, small)) {
    y += small.size * PT * 1.35;
    text(ctx, row, X, y, small, "left", "disclaimer");
  }
  return { bottom: y + 1, qr: sign.qr };
}

export function renderProposalPdfDocument(content: ProposalContent): ProposalPdfRender {
  const d = content.design;
  const measure = createBrandPdf({ title: "Коммерческое предложение WeSetup" });
  const fits = (s: number) => compose({ pdf: measure, d, s, draw: false, bounds: [] }).bottom <= BRAND_CONTENT_BOTTOM;
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
  const ctx: Ctx = { pdf, d, s: scale, draw: true, bounds: [] };
  const seller = brandSeller({ ...d.seller, site: "wesetup.ru" });
  letterhead(pdf, seller);
  footerCard(pdf, seller);
  mark(ctx, X, MARGIN_TOP, X + W, MARGIN_TOP + 21, "letterhead");
  mark(ctx, X, PAGE_H - MARGIN_BOTTOM - 12, X + W, PAGE_H - MARGIN_BOTTOM, "footer");
  const body = compose(ctx);
  return {
    buffer: Buffer.from(pdf.doc.output("arraybuffer")),
    pages: pdf.doc.getNumberOfPages(),
    bounds: ctx.bounds,
    scale,
    qr: { url: d.contact.qrUrl, box: body.qr.box, module: body.qr.module },
  };
}
