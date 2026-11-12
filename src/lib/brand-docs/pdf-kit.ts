import fs from "node:fs";
import path from "node:path";

import { jsPDF } from "jspdf";
import autoTable, { type CellInput, type Styles } from "jspdf-autotable";
import QRCode from "qrcode";

import { pngSize } from "@/lib/closing-documents/pdf";
import { registerProposalFonts, type ProposalWeight } from "@/lib/proposal/pdf-font";

import { formatPhone } from "./phone";

/**
 * Фирменный стиль документов WeSetup (jsPDF, A4, мм) — договор, КП и счёт.
 * Образец — шаблоны «WeSetup - шаблоны (без покупателя, новый стиль)»
 * (брендбук сетап 1.0, правка 2026-11-07): белый бланк — знак «Полночь» и
 * «Ваш электронный ХАССП» слева, реквизиты продавца справа, под шапкой
 * фирменный «маршрут» (пунктир, первое кольцо залито); подвал — знак,
 * маршрут ровно по центру листа и сайт или «Страница N из M» справа.
 * Один шрифт и пять кеглей (22 / 11,5 / 10,5 / 9,5 / 7,5), никаких
 * прописных с разрядкой; таблицы без тёмных шапок — тонкие линии, крайние
 * колонки ровно по краям набора.
 *
 * Реквизиты продавца — всегда параметром (`BrandSeller` из
 * `readPlatformRequisites()`), здесь ничего не захардкожено.
 *
 * Шрифт — Manrope (OFL, файлы в `src/lib/pdf-fonts`), запасной — DejaVu
 * (`registerProposalFonts`). Картинки — два маленьких PNG в `assets/`;
 * карточки рисуются примитивами jsPDF.
 *
 * Порядок работы: `createBrandPdf()` → рисовать содержимое внутри
 * `BRAND_CONTENT_TOP…BRAND_CONTENT_BOTTOM` (поток `BrandFlow` сам
 * переносит строки на новый лист) → `decoratePages()` в самом конце:
 * шапка, подвал и «Стр. N из M» на каждом листе.
 */

export type RGB = readonly [number, number, number];

const hex = (value: string): RGB => [
  parseInt(value.slice(0, 2), 16),
  parseInt(value.slice(2, 4), 16),
  parseInt(value.slice(4, 6), 16),
];

/** Палитра образца (токены дизайн-системы + цвета визитки). */
export const BRAND_COLORS = {
  ink: hex("0B1024"),
  ink2: hex("3C4053"),
  muted: hex("6F7282"),
  faint: hex("9B9FB3"),
  indigo: hex("5566F6"),
  indigoDeep: hex("3848C7"),
  tint: hex("F5F6FF"),
  tint2: hex("EEF1FF"),
  soft: hex("FAFBFF"),
  border: hex("E6E8F2"),
  border2: hex("D5D9EA"),
  grid: hex("B9BED3"),
  greenBg: hex("E3F7EA"),
  greenFg: hex("116B2A"),
  lilac: hex("8E9BF8"),
  lilacText: hex("A3AEF8"),
  lav: hex("C9CEF0"),
  white: hex("FFFFFF"),
} as const;

const C = BRAND_COLORS;

export const BRAND_PAGE = { w: 210, h: 297, side: 12, contentW: 186 } as const;
export const BRAND_HEADER = { top: 5, h: 21, pad: 6, radius: 4.2 } as const;
export const BRAND_FOOTER = { bottom: 5, h: 12, pad: 6, radius: 3.6 } as const;
/** Верх и низ области набора (под шапкой и над строкой «Стр. N из M»). */
export const BRAND_CONTENT_TOP = BRAND_HEADER.top + BRAND_HEADER.h + 7;
/** Верх набора без шапки (formal-документы, напр. договор). */
export const BRAND_PLAIN_TOP = BRAND_HEADER.top + 7;
export const BRAND_CONTENT_BOTTOM = BRAND_PAGE.h - BRAND_FOOTER.bottom - BRAND_FOOTER.h - 7;

/** pt → мм. */
export const PT = 25.4 / 72;

const NBSP = String.fromCharCode(0xa0);

/** Продавец в шапке, подвале и подписи. */
export type BrandSeller = {
  nameShort: string;
  nameFull: string;
  inn: string;
  kpp: string;
  ogrn: string;
  address: string;
  phone: string;
  email: string;
  site: string;
  head: { post: string; name: string };
  bank: { name: string; bik: string; account: string; corrAccount: string };
};

/** Из `PlatformRequisites` (или снимка договора) — пустые поля остаются пустыми. */
export function brandSeller(source: {
  nameShort: string;
  nameFull: string;
  inn: string;
  kpp: string;
  ogrn: string;
  address: string;
  phone: string;
  email: string;
  site?: string | null;
  head: { post: string; name: string };
  bank: { name: string; bik: string; account: string; corrAccount: string };
}): BrandSeller {
  return {
    nameShort: source.nameShort.trim() || source.nameFull.trim(),
    nameFull: source.nameFull.trim(),
    inn: source.inn.trim(),
    kpp: source.kpp.trim(),
    ogrn: source.ogrn.trim(),
    address: source.address.trim(),
    phone: formatPhone(source.phone),
    email: source.email.trim(),
    site: source.site?.trim() || "wesetup.ru",
    head: { post: source.head.post.trim(), name: source.head.name.trim() },
    bank: { ...source.bank },
  };
}

export { formatPhone };

export type BrandFaces = Record<ProposalWeight, { family: string; style: "normal" | "bold" }>;

export type BrandPdf = { doc: jsPDF; faces: BrandFaces; brandFont: boolean };

export function createBrandPdf(meta: { title: string; subject?: string; author?: string }): BrandPdf {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const fonts = registerProposalFonts(doc);
  doc.setProperties({
    title: meta.title,
    subject: meta.subject ?? "WeSetup — электронные журналы СанПиН и ХАССП",
    author: meta.author ?? "WeSetup",
    creator: "WeSetup",
  });
  doc.setLanguage("ru");
  return { doc, faces: fonts.face, brandFont: fonts.brand };
}

export type TextStyle = { size: number; weight?: ProposalWeight; color?: RGB };

export function setText(pdf: BrandPdf, style: TextStyle): void {
  const face = pdf.faces[style.weight ?? "regular"];
  pdf.doc.setFont(face.family, face.style);
  pdf.doc.setFontSize(style.size);
  const [r, g, b] = style.color ?? C.ink;
  pdf.doc.setTextColor(r, g, b);
}

export function textWidth(pdf: BrandPdf, text: string, style: TextStyle): number {
  setText(pdf, style);
  return pdf.doc.getTextWidth(text);
}

/** Высота строки, мм. */
export function lineHeight(size: number, lh = 1.4): number {
  return size * PT * lh;
}

/** Укорачивает строку до ширины, добавляя «…». */
export function fitText(pdf: BrandPdf, text: string, maxWidth: number, style: TextStyle): string {
  if (textWidth(pdf, text, style) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(pdf, `${cut}…`, style) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

// ───────────────────────────── картинки ─────────────────────────────

const ASSET_DIR = path.join(process.cwd(), "src", "lib", "brand-docs", "assets");
const assetCache = new Map<string, Buffer | null>();

export type BrandAssetName =
  | "wordmark-gradient.png"
  | "wordmark-polnoch.png"
  | "route-header.png"
  | "route-footer.png"
  | "icon-nfc.png"
  | "icon-phone.png"
  | "icon-mail.png"
  | "check.png";

export function brandAsset(name: BrandAssetName): Buffer | null {
  if (!assetCache.has(name)) {
    const file = path.join(ASSET_DIR, name);
    assetCache.set(name, fs.existsSync(file) ? fs.readFileSync(file) : null);
  }
  return assetCache.get(name) ?? null;
}

/** Рисует PNG, вписанный в рамку (по центру). Возвращает фактический размер. */
export function drawPng(pdf: BrandPdf, image: Buffer | null, box: { x: number; y: number; w: number; h: number }, align: "center" | "left" = "center") {
  if (!image) return null;
  const size = pngSize(image);
  if (!size || !size.width || !size.height) return null;
  const scale = Math.min(box.w / size.width, box.h / size.height);
  const w = size.width * scale;
  const h = size.height * scale;
  const x = align === "left" ? box.x : box.x + (box.w - w) / 2;
  pdf.doc.addImage(new Uint8Array(image), "PNG", x, box.y + (box.h - h) / 2, w, h, undefined, "FAST");
  return { x, y: box.y + (box.h - h) / 2, w, h };
}

function fill(pdf: BrandPdf, color: RGB) {
  pdf.doc.setFillColor(color[0], color[1], color[2]);
}

function stroke(pdf: BrandPdf, color: RGB, width: number) {
  pdf.doc.setDrawColor(color[0], color[1], color[2]);
  pdf.doc.setLineWidth(width);
}

// ─────────────────────────── шапка и подвал ───────────────────────────

/** Подпись под знаком в шапке (брендбук сетап 1.0). */
export const BRAND_TAGLINE = "Ваш электронный ХАССП";
/** Подпись рядом со знаком в подвале. */
export const BRAND_FOOTER_TAGLINE = "Электронные журналы";
/** Точки маршрута — светлый индиго брендбука. */
const ROUTE_DOTS = hex("A9B2F6");
/** Базовая линия подвала, мм. */
const FOOTER_BASE = BRAND_PAGE.h - 8.9;

/** Пунктир из точек от (x1, y1) до (x2, y2): круглые концы штрихов нулевой длины. */
function dottedLine(pdf: BrandPdf, x1: number, y1: number, x2: number, y2: number): void {
  const { doc } = pdf;
  stroke(pdf, ROUTE_DOTS, 0.32);
  doc.setLineCap("round");
  doc.setLineDashPattern([0.001, 0.98], 0);
  doc.line(x1, y1, x2, y2);
  doc.setLineDashPattern([], 0);
  doc.setLineCap("butt");
}

/** Кольцо маршрута: залитое («вы здесь») или полое. */
export function routeNode(pdf: BrandPdf, cx: number, cy: number, filled: boolean, r = filled ? 1.06 : 0.95): void {
  if (filled) {
    fill(pdf, C.indigo);
    pdf.doc.circle(cx, cy, r, "F");
    return;
  }
  fill(pdf, C.white);
  stroke(pdf, C.indigo, 0.37);
  pdf.doc.circle(cx, cy, r - 0.18, "FD");
}

/** Фирменный маршрут по горизонтали: первое кольцо залито, последнее — полое, между ними точки. */
export function routeLine(pdf: BrandPdf, x0: number, x1: number, y: number): void {
  dottedLine(pdf, x0 + 3.2, y, x1 - 3.2, y);
  routeNode(pdf, x0 + 1.06, y, true);
  routeNode(pdf, x1 - 0.95, y, false);
}

/** Маршрут по вертикали — «Как начать»: кольца в точках `ys`, первое залито. */
export function routeRail(pdf: BrandPdf, x: number, ys: readonly number[]): void {
  if (ys.length > 1) dottedLine(pdf, x, ys[0] + 2.4, x, ys[ys.length - 1] - 2.2);
  ys.forEach((y, index) => routeNode(pdf, x, y, index === 0, index === 0 ? 1.48 : 1.35));
}

/**
 * Белый бланк текущего листа: знак и подпись слева, реквизиты продавца справа, маршрут под ними.
 * Знак и шрифт — как в счёте (12.11.2026): чёрный текст основного кегля, без бледно-серого.
 */
export function letterhead(pdf: BrandPdf, seller: BrandSeller): void {
  const { doc } = pdf;
  const { side, contentW } = BRAND_PAGE;
  const left = side;
  const right = side + contentW;
  const top = 7;
  const drawn = drawPng(pdf, brandAsset("wordmark-polnoch.png"), { x: left, y: top, w: 34, h: 6.6 }, "left");
  if (!drawn) {
    setText(pdf, { size: 17, weight: "extrabold", color: C.ink });
    doc.text("сетап", left, top + 5.6);
  }
  setText(pdf, { size: 8.5, color: C.ink });
  doc.text(BRAND_TAGLINE, left, top + 12);

  const infoWidth = contentW - 60;
  const nameStyle: TextStyle = { size: 9.5, weight: "semibold", color: C.ink };
  const name = fitText(pdf, seller.nameShort, infoWidth, nameStyle);
  setText(pdf, nameStyle);
  doc.text(name, right, top + 3.6, { align: "right" });
  const ids = [
    seller.inn ? `ИНН${NBSP}${seller.inn}` : null,
    seller.kpp ? `КПП${NBSP}${seller.kpp}` : null,
    seller.ogrn ? `${seller.ogrn.length === 15 ? "ОГРНИП" : "ОГРН"}${NBSP}${seller.ogrn}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const contacts = [seller.phone ? `тел.${NBSP}${seller.phone}` : null, seller.email, seller.site].filter(Boolean).join(", ");
  const lines = [ids, seller.address, contacts].filter(Boolean);
  const style: TextStyle = { size: 8.5, color: C.ink };
  lines.forEach((line, index) => {
    const fitted = fitText(pdf, line, infoWidth, style);
    setText(pdf, style);
    doc.text(fitted, right, top + 8.3 + index * 4.1, { align: "right" });
  });
  routeLine(pdf, left, right, 30.2);
}

/** Подвал текущего листа: знак и подпись слева, маршрут ровно по центру листа, справа — сайт или номер страницы. */
export function footerCard(
  pdf: BrandPdf,
  seller: BrandSeller,
  tagline = BRAND_FOOTER_TAGLINE,
  /** Текст справа; по умолчанию «сайт · продавец». */
  rightLine?: string,
): void {
  const { doc } = pdf;
  const { side, contentW, w: pageW } = BRAND_PAGE;
  const drawn = drawPng(pdf, brandAsset("wordmark-polnoch.png"), { x: side, y: FOOTER_BASE - 2.35, w: 12.5, h: 2.42 }, "left");
  setText(pdf, { size: 7.5, color: C.muted });
  doc.text(tagline, side + (drawn ? 15 : 0), FOOTER_BASE);
  routeLine(pdf, pageW / 2 - 32, pageW / 2 + 32, FOOTER_BASE - 1);
  // Справа — не шире своей трети: длинное полное наименование не наезжает на маршрут.
  const room = side + contentW - (pageW / 2 + 32) - 4;
  const style: TextStyle = { size: 7.5, color: C.muted };
  const candidates = rightLine ? [rightLine] : [[seller.site, seller.nameShort].filter(Boolean).join("  ·  "), seller.site];
  const right = candidates.find((item) => textWidth(pdf, item, style) <= room) ?? fitText(pdf, candidates[0], room, style);
  setText(pdf, style);
  doc.text(right, side + contentW, FOOTER_BASE, { align: "right" });
}

export type DecorateOptions = {
  /** Подпись справа над подвалом: «Договор № … · Стр. 2 из 7». null — не рисовать. */
  pageLabel?: ((page: number, total: number) => string) | null;
  /** Подпись слева над подвалом (например, места для инициалов сторон). */
  footnoteLeft?: (page: number, total: number) => string | null;
  /** «Страница N из M» в подвале справа (как в договоре образца). */
  pageInFooter?: boolean;
  /** false — без брендовой шапки (договор: formal, без «стильной» шапки). */
  letterhead?: boolean;
};

/** Шапка, подвал и подписи над подвалом — на каждом листе. Вызывать последним. */
export function decoratePages(pdf: BrandPdf, seller: BrandSeller, options: DecorateOptions = {}): number {
  const { doc } = pdf;
  const total = doc.getNumberOfPages();
  const labelY = BRAND_PAGE.h - BRAND_FOOTER.bottom - BRAND_FOOTER.h - 2.6;
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    if (options.letterhead !== false) letterhead(pdf, seller);
    footerCard(pdf, seller, undefined, options.pageInFooter ? `Страница${NBSP}${page} из ${total}` : undefined);
    const fallback = options.pageInFooter ? null : `Страница${NBSP}${page} из ${total}`;
    const label = options.pageLabel === null ? null : options.pageLabel ? options.pageLabel(page, total) : fallback;
    setText(pdf, { size: 7, color: C.faint });
    if (label) doc.text(label, BRAND_PAGE.side + BRAND_PAGE.contentW, labelY, { align: "right" });
    const note = options.footnoteLeft?.(page, total);
    if (note) doc.text(note, BRAND_PAGE.side, labelY);
  }
  return total;
}

// ───────────────────────────── блоки ─────────────────────────────

/** Строка над заголовком документа («Коммерческое предложение · тариф …») — серым основным кеглем, без прописных. */
export function eyebrow(pdf: BrandPdf, text: string, x: number, y: number, color: RGB = C.muted): void {
  setText(pdf, { size: 9.5, color });
  pdf.doc.text(text, x, y);
}

/** Кегль заголовка раздела — тот же, что у «Здравствуйте» в КП и разделов договора. */
export const SECTION_SIZE = 11.5;

/** «1  Термины» (номер индиго) или просто «Стоимость за одну точку». y — базовая линия. Возвращает высоту блока. */
export function sectionTitle(pdf: BrandPdf, x: number, y: number, title: { num?: string | number | null; title: string; hint?: string | null }): number {
  const { doc } = pdf;
  let titleX = x;
  if (title.num !== undefined && title.num !== null) {
    const num = String(title.num);
    setText(pdf, { size: SECTION_SIZE, weight: "semibold", color: C.indigo });
    doc.text(num, x, y);
    titleX = x + doc.getTextWidth(num) + 2.6;
  }
  setText(pdf, { size: SECTION_SIZE, weight: "semibold", color: C.ink });
  doc.text(title.title, titleX, y);
  if (title.hint) {
    const hintX = titleX + doc.getTextWidth(title.title) + 3;
    setText(pdf, { size: 9.5, color: C.muted });
    doc.text(title.hint, hintX, y);
  }
  return lineHeight(SECTION_SIZE, 1.25);
}

export type DataTableOptions = {
  startY: number;
  head?: CellInput[][];
  body: CellInput[][];
  columnStyles?: Record<number, Partial<Styles>>;
  /** Светлая «зебра» строк. По умолчанию — да. */
  zebra?: boolean;
  fontSize?: number;
  x?: number;
  width?: number;
};

/**
 * Таблица «по-современному» (jspdf-autotable): шапка — мелкие серые подписи
 * над тёмной тонкой линией, строки — тонкие светлые линии; текст первой
 * колонки — ровно по левому краю набора, последней — по правому. Шрифты —
 * Manrope «normal» всех начертаний: синтетического bold у jsPDF нет.
 * Переносит строки на следующий лист в пределах области набора. Возвращает низ таблицы.
 */
export function dataTable(pdf: BrandPdf, options: DataTableOptions): number {
  const x = options.x ?? BRAND_PAGE.side;
  const width = options.width ?? BRAND_PAGE.contentW;
  const size = options.fontSize ?? 8.5;
  const pad = 2.6;
  autoTable(pdf.doc, {
    startY: options.startY,
    margin: { left: x, right: BRAND_PAGE.w - x - width, top: BRAND_CONTENT_TOP, bottom: BRAND_PAGE.h - BRAND_CONTENT_BOTTOM },
    tableWidth: width,
    head: options.head,
    body: options.body,
    theme: "plain",
    styles: {
      font: pdf.faces.regular.family,
      fontStyle: "normal",
      fontSize: size,
      textColor: [...C.ink] as [number, number, number],
      cellPadding: { top: 2.2, bottom: 2.2, left: pad, right: pad },
      lineColor: [...C.border] as [number, number, number],
      lineWidth: { bottom: 0.2 },
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: {
      font: pdf.faces.regular.family,
      fontStyle: "normal",
      fontSize: 7.5,
      textColor: [...C.muted] as [number, number, number],
      cellPadding: { top: 1.4, bottom: 1.8, left: pad, right: pad },
      lineColor: [...C.ink] as [number, number, number],
      lineWidth: { bottom: 0.3 },
      valign: "bottom",
    },
    alternateRowStyles: options.zebra === true ? { fillColor: [...C.soft] as [number, number, number] } : undefined,
    columnStyles: options.columnStyles,
    didParseCell: (data) => {
      // Крайние колонки — без внешнего поля: текст стоит на краях набора, как заголовки над таблицей.
      const last = data.table.columns.length - 1;
      if (data.column.index !== 0 && data.column.index !== last) return;
      const padding = data.cell.styles.cellPadding;
      const box = typeof padding === "number" ? { top: padding, bottom: padding, left: padding, right: padding } : { top: 2.2, bottom: 2.2, left: pad, right: pad, ...padding };
      data.cell.styles.cellPadding = { ...box, ...(data.column.index === 0 ? { left: 0 } : {}), ...(data.column.index === last ? { right: 0 } : {}) };
    },
  });
  return (pdf.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

export type PartyRow = { label: string; value: string; strong?: boolean };

/**
 * Пары «подпись — значение» с тонкой линией под каждой (как «Поставщик /
 * Покупатель» в счёте или колонка реквизитов в договоре). Значение
 * переносится по ширине. Возвращает низ блока.
 */
export function partyRows(
  pdf: BrandPdf,
  options: { x?: number; y: number; width?: number; labelWidth?: number; rows: readonly PartyRow[]; size?: number },
): number {
  const { doc } = pdf;
  const x = options.x ?? BRAND_PAGE.side;
  const width = options.width ?? BRAND_PAGE.contentW;
  const labelWidth = options.labelWidth ?? 46;
  const size = options.size ?? 8.5;
  const lh = lineHeight(size, 1.32);
  let y = options.y;
  for (const row of options.rows) {
    const valueStyle: TextStyle = { size, weight: row.strong ? "semibold" : "regular", color: C.ink };
    setText(pdf, valueStyle);
    const lines = doc.splitTextToSize(row.value, width - labelWidth - 1) as string[];
    setText(pdf, { size: size - 0.5, color: C.muted });
    const labelLines = doc.splitTextToSize(row.label, labelWidth - 2) as string[];
    const rowH = Math.max(lines.length, labelLines.length) * lh + 2.4;
    doc.text(labelLines, x, y + 1.2 + lh * 0.78);
    setText(pdf, valueStyle);
    doc.text(lines, x + labelWidth, y + 1.2 + lh * 0.78);
    y += rowH;
    stroke(pdf, C.border, 0.2);
    doc.line(x, y, x + width, y);
  }
  return y;
}

/** Высота `partyRows` без рисования — чтобы заранее решить, нужен ли новый лист. */
export function measurePartyRows(pdf: BrandPdf, options: { width?: number; labelWidth?: number; rows: readonly PartyRow[]; size?: number }): number {
  const { doc } = pdf;
  const width = options.width ?? BRAND_PAGE.contentW;
  const labelWidth = options.labelWidth ?? 46;
  const size = options.size ?? 8.5;
  const lh = lineHeight(size, 1.32);
  let total = 0;
  for (const row of options.rows) {
    setText(pdf, { size, weight: row.strong ? "semibold" : "regular" });
    const lines = (doc.splitTextToSize(row.value, width - labelWidth - 1) as string[]).length;
    setText(pdf, { size: size - 0.5 });
    const labelLines = (doc.splitTextToSize(row.label, labelWidth - 2) as string[]).length;
    total += Math.max(lines, labelLines) * lh + 2.4;
  }
  return total;
}

/** Классическая сетка банковских реквизитов получателя над счётом. Возвращает низ. */
export function bankGrid(pdf: BrandPdf, options: { y: number; seller: BrandSeller }): number {
  const { doc } = pdf;
  const { seller } = options;
  const x = BRAND_PAGE.side;
  const w = BRAND_PAGE.contentW;
  const y = options.y;
  const rowH = 7.4;
  const col1 = x + 102; // конец «банк / ИНН / получатель»
  const col2 = col1 + 18; // конец «БИК / Сч. №»
  const half = x + 51; // ИНН | КПП
  stroke(pdf, C.border2, 0.2);
  doc.rect(x, y, w, rowH * 4.4);
  doc.line(col1, y, col1, y + rowH * 4.4);
  doc.line(col2, y, col2, y + rowH * 4.4);
  doc.line(x, y + rowH * 2, col1, y + rowH * 2);
  doc.line(x, y + rowH * 3, col1, y + rowH * 3);
  doc.line(half, y + rowH * 2, half, y + rowH * 3);
  doc.line(col1, y + rowH, x + w, y + rowH);
  doc.line(col1, y + rowH * 2, x + w, y + rowH * 2);

  const cell = (text: string, cx: number, cy: number, style: TextStyle) => {
    setText(pdf, style);
    doc.text(text, cx + 2.4, cy);
  };
  cell(seller.bank.name || "—", x, y + 5, { size: 8.5, weight: "semibold" });
  cell("Банк получателя", x, y + 10.4, { size: 7.5, color: C.muted });
  cell(`ИНН ${seller.inn || "—"}`, x, y + rowH * 2 + 4.9, { size: 8.5 });
  cell(`КПП ${seller.kpp || "—"}`, half, y + rowH * 2 + 4.9, { size: 8.5 });
  cell(seller.nameShort || "—", x, y + rowH * 3 + 5, { size: 8.5, weight: "semibold" });
  cell("Получатель", x, y + rowH * 3 + 9.6, { size: 7.5, color: C.muted });
  cell("БИК", col1, y + 4.9, { size: 8.5, color: C.muted });
  cell("Сч. №", col1, y + rowH + 4.9, { size: 8.5, color: C.muted });
  cell("Сч. №", col1, y + rowH * 2 + 4.9, { size: 8.5, color: C.muted });
  cell(seller.bank.bik || "—", col2, y + 4.9, { size: 8.5 });
  cell(seller.bank.corrAccount || "—", col2, y + rowH + 4.9, { size: 8.5 });
  cell(seller.bank.account || "—", col2, y + rowH * 2 + 4.9, { size: 8.5, weight: "semibold" });
  return y + rowH * 4.4;
}

/**
 * Строка подписи: должность, линия, расшифровка «Волков Д. В.», «М. П.».
 * Факсимиле — поверх линии, печать — с наложением на подпись (как на
 * бумаге). Возвращает низ блока.
 */
export function signatureLine(
  pdf: BrandPdf,
  options: {
    x: number;
    y: number;
    width: number;
    post: string;
    name: string;
    facsimile?: Buffer | null;
    stamp?: Buffer | null;
    stampLabel?: boolean;
  },
): number {
  const { doc } = pdf;
  const { x, width } = options;
  let y = options.y;
  setText(pdf, { size: 9.5, color: C.muted });
  const postLines = doc.splitTextToSize(options.post, width) as string[];
  doc.text(postLines, x, y + 3);
  y += postLines.length * lineHeight(9.5, 1.3) + 9;
  const lineW = Math.min(36, width * 0.45);
  stroke(pdf, C.faint, 0.25);
  doc.line(x, y, x + lineW, y);
  setText(pdf, { size: 9.5, color: C.ink });
  doc.text(options.name, x + lineW + 2.4, y - 0.6);
  setText(pdf, { size: 7.5, color: C.faint });
  doc.text("подпись", x + lineW / 2, y + 3.2, { align: "center" });
  if (options.stampLabel !== false) doc.text("М. П.", x, y + 9);
  if (options.stamp) drawPng(pdf, options.stamp, { x: x + 8, y: y - 13, w: 31, h: 31 });
  if (options.facsimile) drawPng(pdf, options.facsimile, { x: x + 1, y: y - 10, w: lineW - 2, h: 11 });
  return y + 11;
}

/**
 * Подпись отправителя в духе КП: кружок с инициалами, «С уважением,»,
 * имя, должность и строка подписи. Возвращает низ блока.
 */
export function signatureBlock(
  pdf: BrandPdf,
  options: { x?: number; y: number; sender: { name: string; post: string; orgShort?: string | null }; facsimile?: Buffer | null },
): number {
  const { doc } = pdf;
  const x = options.x ?? BRAND_PAGE.side;
  const y = options.y;
  const { sender } = options;
  const initials = sender.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  avatar(pdf, x + 5.8, y + 5.8, 5.6, initials || "WS");
  const tx = x + 15;
  setText(pdf, { size: 9.5, color: C.muted });
  doc.text("С уважением,", tx, y + 3);
  setText(pdf, { size: SECTION_SIZE, weight: "semibold", color: C.ink });
  doc.text(sender.name, tx, y + 9);
  setText(pdf, { size: 9.5, color: C.muted });
  doc.text([sender.post, sender.orgShort].filter(Boolean).join(" "), tx, y + 13.4);
  stroke(pdf, C.faint, 0.25);
  doc.line(tx, y + 22, tx + 34, y + 22);
  if (options.facsimile) drawPng(pdf, options.facsimile, { x: tx + 1, y: y + 12, w: 32, h: 11 });
  return y + 25;
}

// ───────────────────────────── QR и значки ─────────────────────────────

/**
 * Простой QR без рамки (как в образце): тёмные модули прямоугольниками,
 * вектор — печатается чётко. Возвращает сторону модуля, мм.
 */
export function drawQr(
  pdf: BrandPdf,
  text: string,
  box: { x: number; y: number; size: number },
  options: { ecc?: "L" | "M" | "Q" | "H"; color?: RGB } = {},
): { module: number; modules: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: options.ecc ?? "M" });
  const n = qr.modules.size;
  const cell = box.size / n;
  fill(pdf, options.color ?? C.ink);
  for (let row = 0; row < n; row += 1) {
    let start = -1;
    for (let col = 0; col <= n; col += 1) {
      const dark = col < n && qr.modules.get(row, col);
      if (dark && start < 0) start = col;
      if (!dark && start >= 0) {
        // Серии модулей одной строки — одним прямоугольником (меньше PDF, без щелей).
        pdf.doc.rect(box.x + start * cell, box.y + row * cell, (col - start) * cell + 0.01, cell + 0.01, "F");
        start = -1;
      }
    }
  }
  return { module: cell, modules: n };
}

/** Кружок с инициалами: светлый индиго, буквы — тёмный индиго (как аватар на сайте). */
export function avatar(pdf: BrandPdf, cx: number, cy: number, r: number, initials: string): void {
  fill(pdf, C.tint2);
  pdf.doc.circle(cx, cy, r, "F");
  setText(pdf, { size: r * 1.9, weight: "semibold", color: C.indigoDeep });
  pdf.doc.text(initials, cx, cy + r * 1.9 * PT * 0.36, { align: "center" });
}

/**
 * QR в мягкой рамке (как в шаблонах): белое поле, тонкая светлая обводка,
 * скругление. `box` — внешняя рамка; возвращает сторону модуля и рамку самого кода.
 */
export function drawFramedQr(
  pdf: BrandPdf,
  text: string,
  box: { x: number; y: number; size: number },
  options: { ecc?: "L" | "M" | "Q" | "H" } = {},
): { module: number; modules: number; code: { x: number; y: number; size: number } } {
  const pad = box.size * 0.075;
  fill(pdf, C.white);
  stroke(pdf, C.border2, 0.3);
  pdf.doc.roundedRect(box.x, box.y, box.size, box.size, box.size * 0.11, box.size * 0.11, "FD");
  const code = { x: box.x + pad, y: box.y + pad, size: box.size - 2 * pad };
  return { ...drawQr(pdf, text, code, options), code };
}

/** Галочка в светлом кружке (PNG образца) — «есть» в таблице сравнения; jsPDF кладёт картинку в файл один раз. */
export function checkBadge(pdf: BrandPdf, cx: number, cy: number, size = 3.4): void {
  drawPng(pdf, brandAsset("check.png"), { x: cx - size / 2, y: cy - size / 2, w: size, h: size });
}

/** Значок «телефон» / «почта» (lucide, PNG образца). */
export function contactIcon(pdf: BrandPdf, kind: "phone" | "mail", x: number, y: number, size = 3.2): void {
  drawPng(pdf, brandAsset(kind === "phone" ? "icon-phone.png" : "icon-mail.png"), { x, y, w: size, h: size }, "left");
}

// ───────────────────────────── поток текста ─────────────────────────────

type Word = { text: string; width: number };

// ───────────────────────────── переносы ─────────────────────────────

const RU_VOWEL = /[аеёиоуыэюя]/i;
const RU_CONSONANT = /[бвгджзклмнпрстфхцчшщ]/i;
const RU_SIGN = /[йъь]/i;
const RU_LETTER = /[а-яё]/i;

/**
 * Места переноса в русском слове — правила П. Христова (как в простых
 * переносчиках): после «й/ъ/ь» перед двумя буквами, между гласными, между
 * согласными на стыке слогов. Осторожно: слева не меньше двух букв, справа —
 * не меньше трёх; слова с цифрами, латиницей и аббревиатуры не переносим.
 */
export function hyphenationPoints(word: string): number[] {
  // Аббревиатуры и слова с заглавными внутри («СанПиН», «ХАССП») не переносим.
  if (word.length < 6 || !/^[а-яё]+$/i.test(word) || /[А-ЯЁ]/.test(word.slice(1))) return [];
  const is = (re: RegExp, index: number) => index >= 0 && index < word.length && re.test(word[index]);
  const points: number[] = [];
  for (let p = 2; p <= word.length - 3; p += 1) {
    const v = (i: number) => is(RU_VOWEL, i);
    const c = (i: number) => is(RU_CONSONANT, i);
    const any = (i: number) => is(RU_LETTER, i);
    const ok =
      (is(RU_SIGN, p - 1) && any(p) && any(p + 1)) ||
      (v(p - 1) && v(p) && any(p + 1)) ||
      (v(p - 2) && c(p - 1) && c(p) && v(p + 1)) ||
      (c(p - 2) && v(p - 1) && c(p) && v(p + 1)) ||
      (v(p - 2) && c(p - 1) && c(p) && c(p + 1) && v(p + 2)) ||
      (v(p - 3) && c(p - 2) && c(p - 1) && c(p) && c(p + 1) && v(p + 2));
    // «й», «ъ», «ь» не отрываются от предыдущей буквы.
    if (ok && !is(RU_SIGN, p)) points.push(p);
  }
  return points;
}

/**
 * Поток набора: абзацы с выключкой по ширине (вручную — word spacing jsPDF
 * не работает со шрифтами Identity-H), перенос на новый лист в пределах
 * `BRAND_CONTENT_TOP…BRAND_CONTENT_BOTTOM`.
 */
export class BrandFlow {
  y: number;
  readonly x: number;
  readonly width: number;

  readonly top: number;

  constructor(
    readonly pdf: BrandPdf,
    options: { x?: number; width?: number; y?: number; top?: number } = {},
  ) {
    this.x = options.x ?? BRAND_PAGE.side;
    this.width = options.width ?? BRAND_PAGE.contentW;
    this.top = options.top ?? BRAND_CONTENT_TOP;
    this.y = options.y ?? this.top;
  }

  get remaining(): number {
    return BRAND_CONTENT_BOTTOM - this.y;
  }

  newPage(): void {
    this.pdf.doc.addPage();
    this.y = this.top;
  }

  /** Новый лист, если до низа области набора меньше `height` мм. */
  ensure(height: number): void {
    if (this.y + height > BRAND_CONTENT_BOTTOM) this.newPage();
  }

  gap(mm: number): void {
    this.y = Math.min(this.y + mm, BRAND_CONTENT_BOTTOM);
  }

  private words(text: string, style: TextStyle): Word[] {
    setText(this.pdf, style);
    return text
      .split(/ +/)
      .filter(Boolean)
      .map((word) => ({ text: word, width: this.pdf.doc.getTextWidth(word) }));
  }

  /**
   * Слово, которое не влезло в строку, — с переносом: самая длинная часть
   * «слог-», что помещается в остаток строки. Знаки препинания вокруг слова
   * остаются при своих половинах. Нет подходящего места — null.
   */
  private hyphenate(word: Word, room: number): [Word, Word] | null {
    const match = /^([^а-яё]*)([а-яё]+)([^а-яё]*)$/i.exec(word.text);
    if (!match) return null;
    const [, before, core, after] = match;
    const points = hyphenationPoints(core);
    for (let index = points.length - 1; index >= 0; index -= 1) {
      const head = `${before}${core.slice(0, points[index])}-`;
      const headWidth = this.pdf.doc.getTextWidth(head);
      if (headWidth > room) continue;
      const tail = `${core.slice(points[index])}${after}`;
      return [
        { text: head, width: headWidth },
        { text: tail, width: this.pdf.doc.getTextWidth(tail) },
      ];
    }
    return null;
  }

  /**
   * Разбивка на строки; первая строка может быть короче (после номера пункта).
   * Слово, не влезшее в строку, переносится по слогам (не больше двух строк
   * подряд с переносом) — строки по ширине не растягиваются пробелами.
   */
  layout(text: string, style: TextStyle, width: number, firstLineWidth = width): Word[][] {
    setText(this.pdf, style);
    const space = this.pdf.doc.getTextWidth(" ");
    const lines: Word[][] = [];
    let current: Word[] = [];
    let currentWidth = 0;
    let hyphenStreak = 0;
    for (const word of this.words(text, style)) {
      const limit = lines.length === 0 ? firstLineWidth : width;
      const next = current.length ? currentWidth + space + word.width : word.width;
      if (current.length && next > limit) {
        const split = hyphenStreak < 2 ? this.hyphenate(word, limit - currentWidth - space) : null;
        if (split) {
          current.push(split[0]);
          hyphenStreak += 1;
        } else {
          hyphenStreak = 0;
        }
        lines.push(current);
        const rest = split ? split[1] : word;
        current = [rest];
        currentWidth = rest.width;
      } else {
        current.push(word);
        currentWidth = next;
      }
    }
    if (current.length) lines.push(current);
    return lines;
  }

  private drawLine(words: Word[], x: number, y: number, width: number, justify: boolean): void {
    const { doc } = this.pdf;
    if (!justify || words.length < 2) {
      doc.text(words.map((word) => word.text).join(" "), x, y);
      return;
    }
    const total = words.reduce((sum, word) => sum + word.width, 0);
    const gap = (width - total) / (words.length - 1);
    let cursor = x;
    for (const word of words) {
      doc.text(word.text, cursor, y);
      cursor += word.width + gap;
    }
  }

  /**
   * Абзац. `lead` — жирный префикс в первой строке («3.2.»), `indent` —
   * отступ всего абзаца (подпункты «а)»: маркер в отступе, текст висит).
   */
  paragraph(
    text: string,
    options: { size?: number; lh?: number; color?: RGB; weight?: ProposalWeight; lead?: string; indent?: number; marker?: string; justify?: boolean; after?: number } = {},
  ): void {
    const size = options.size ?? 9;
    const style: TextStyle = { size, weight: options.weight ?? "regular", color: options.color ?? C.ink2 };
    const leadStyle: TextStyle = { size, weight: "semibold", color: C.indigoDeep };
    const lh = lineHeight(size, options.lh ?? 1.42);
    const indent = options.indent ?? 0;
    const x = this.x + indent;
    const width = this.width - indent;
    const leadWidth = options.lead ? textWidth(this.pdf, `${options.lead} `, leadStyle) : 0;
    const lines = this.layout(text, style, width, width - leadWidth);
    const justify = options.justify ?? true;
    // Висячие строки: первая строка абзаца не остаётся одна внизу листа,
    // последняя — одна вверху следующего (переносим предпоследнюю вместе с ней).
    this.ensure(Math.min(lines.length, 2) * lh);
    lines.forEach((line, index) => {
      if (lines.length >= 3 && index === lines.length - 2) this.ensure(2 * lh);
      this.ensure(lh);
      const baseline = this.y + lh * 0.74;
      if (index === 0 && options.lead) {
        setText(this.pdf, leadStyle);
        this.pdf.doc.text(options.lead, x, baseline);
      }
      if (index === 0 && options.marker) {
        setText(this.pdf, { size, weight: "semibold", color: C.indigoDeep });
        this.pdf.doc.text(options.marker, this.x + Math.max(indent - 5, 0), baseline);
      }
      setText(this.pdf, style);
      const offset = index === 0 ? leadWidth : 0;
      this.drawLine(line, x + offset, baseline, width - offset, justify && index < lines.length - 1);
      this.y += lh;
    });
    this.y += options.after ?? 1.2;
  }
}
