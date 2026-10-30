import fs from "node:fs";
import path from "node:path";

import { jsPDF } from "jspdf";
import autoTable, { type CellInput, type Styles } from "jspdf-autotable";
import QRCode from "qrcode";

import { pngSize } from "@/lib/closing-documents/pdf";
import { registerProposalFonts, type ProposalWeight } from "@/lib/proposal/pdf-font";

import { formatPhone } from "./phone";

/**
 * Фирменный стиль документов WeSetup (jsPDF, A4, мм) — договор, а дальше
 * КП и счёт. Образец — «WeSetup - КП и счета (новый дизайн)» (2026-10-29):
 * тёмная скруглённая карточка-шапка на каждом листе (градиентный «сетап»
 * и «Ваш электронный журнал» слева, реквизиты продавца справа), такая же
 * карточка-подвал, нумерованные заголовки разделов «01  Заголовок  пояснение»,
 * таблицы с тёмной строкой заголовка, сиреневые акценты.
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

export type BrandAssetName = "wordmark-gradient.png" | "icon-nfc.png" | "icon-phone.png" | "icon-mail.png" | "check.png";

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

/** Тёмная карточка-шапка текущего листа. */
export function letterhead(pdf: BrandPdf, seller: BrandSeller): void {
  const { doc } = pdf;
  const { side, contentW } = BRAND_PAGE;
  const { top, h, pad, radius } = BRAND_HEADER;
  fill(pdf, C.ink);
  doc.roundedRect(side, top, contentW, h, radius, radius, "F");

  const left = side + pad;
  const right = side + contentW - pad;
  const drawn = drawPng(pdf, brandAsset("wordmark-gradient.png"), { x: left, y: top + 4.6, w: 31.5, h: 6.4 }, "left");
  if (!drawn) {
    setText(pdf, { size: 17, weight: "extrabold", color: C.lilac });
    doc.text("сетап", left, top + 10.2);
  }
  setText(pdf, { size: 9.5, weight: "semibold", color: C.lilacText });
  doc.text("Ваш электронный журнал", left, top + 16.6);

  const infoWidth = contentW - 2 * pad - 52;
  const nameStyle: TextStyle = { size: 9, weight: "semibold", color: C.white };
  const name = fitText(pdf, seller.nameShort, infoWidth, nameStyle);
  setText(pdf, nameStyle);
  doc.text(name, right, top + 6.6, { align: "right" });
  const ids = [
    seller.inn ? `ИНН${NBSP}${seller.inn}` : null,
    seller.kpp ? `КПП${NBSP}${seller.kpp}` : null,
    seller.ogrn ? `${seller.ogrn.length === 15 ? "ОГРНИП" : "ОГРН"}${NBSP}${seller.ogrn}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  const contacts = [seller.phone, seller.email].filter(Boolean).join("  ·  ");
  const lines = [ids, seller.address, contacts].filter(Boolean);
  const style: TextStyle = { size: 7.5, color: C.lav };
  lines.forEach((line, index) => {
    const fitted = fitText(pdf, line, infoWidth, style);
    setText(pdf, style);
    doc.text(fitted, right, top + 10.8 + index * 3.75, { align: "right" });
  });
}

/** Тёмная карточка-подвал текущего листа. */
export function footerCard(
  pdf: BrandPdf,
  seller: BrandSeller,
  tagline = "Электронные журналы по принципам ХАССП",
  /** Вторая строка справа; по умолчанию «почта · продавец». */
  rightLine?: string,
): void {
  const { doc } = pdf;
  const { side, contentW, h: pageH } = BRAND_PAGE;
  const { bottom, h, pad, radius } = BRAND_FOOTER;
  const top = pageH - bottom - h;
  fill(pdf, C.ink);
  doc.roundedRect(side, top, contentW, h, radius, radius, "F");

  const left = side + pad;
  const right = side + contentW - pad;
  setText(pdf, { size: 8.5, weight: "semibold", color: C.white });
  doc.text(tagline, left, top + 5);
  setText(pdf, { size: 8.5, weight: "semibold", color: C.lilac });
  doc.text(seller.site, left, top + 9.3);
  const siteW = doc.getTextWidth(seller.site);
  drawPng(pdf, brandAsset("icon-nfc.png"), { x: left + siteW + 1.6, y: top + 6.6, w: 3.2, h: 3.4 }, "left");

  if (seller.phone) {
    setText(pdf, { size: 8.5, weight: "semibold", color: C.white });
    doc.text(seller.phone, right, top + 5, { align: "right" });
  }
  setText(pdf, { size: 8, color: C.lav });
  doc.text(rightLine ?? [seller.email, seller.nameShort].filter(Boolean).join("  ·  "), right, top + 9.3, { align: "right" });
}

export type DecorateOptions = {
  /** Подпись справа над подвалом: «Договор № … · Стр. 2 из 7». null — не рисовать. */
  pageLabel?: ((page: number, total: number) => string) | null;
  /** Подпись слева над подвалом (например, места для инициалов сторон). */
  footnoteLeft?: (page: number, total: number) => string | null;
  /** «страница N из M» во второй строке подвала справа (как в договоре образца). */
  pageInFooter?: boolean;
};

/** Шапка, подвал и подписи над подвалом — на каждом листе. Вызывать последним. */
export function decoratePages(pdf: BrandPdf, seller: BrandSeller, options: DecorateOptions = {}): number {
  const { doc } = pdf;
  const total = doc.getNumberOfPages();
  const labelY = BRAND_PAGE.h - BRAND_FOOTER.bottom - BRAND_FOOTER.h - 2.6;
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    letterhead(pdf, seller);
    footerCard(
      pdf,
      seller,
      undefined,
      options.pageInFooter ? [seller.email, `страница${NBSP}${page} из ${total}`].filter(Boolean).join("  ·  ") : undefined,
    );
    const fallback = options.pageInFooter ? null : `Стр.${NBSP}${page} из ${total}`;
    const label = options.pageLabel === null ? null : options.pageLabel ? options.pageLabel(page, total) : fallback;
    setText(pdf, { size: 7, color: C.faint });
    if (label) doc.text(label, BRAND_PAGE.side + BRAND_PAGE.contentW, labelY, { align: "right" });
    const note = options.footnoteLeft?.(page, total);
    if (note) doc.text(note, BRAND_PAGE.side, labelY);
  }
  return total;
}

// ───────────────────────────── блоки ─────────────────────────────

/** Надстрочная подпись: «КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ» разрядкой. */
export function eyebrow(pdf: BrandPdf, text: string, x: number, y: number, color: RGB = C.indigo): void {
  setText(pdf, { size: 7.5, weight: "semibold", color });
  pdf.doc.text(text.toUpperCase(), x, y, { charSpace: 0.42 });
}

/** «01  Стоимость  за 1 точку, без НДС». y — базовая линия. Возвращает высоту блока. */
export function sectionTitle(pdf: BrandPdf, x: number, y: number, title: { num?: string | number | null; title: string; hint?: string | null }): number {
  const { doc } = pdf;
  let titleX = x;
  // Образец 2026-10-30 — заголовки без номера; «01» остаётся по желанию.
  if (title.num !== undefined && title.num !== null) {
    const num = typeof title.num === "number" ? String(title.num).padStart(2, "0") : title.num;
    setText(pdf, { size: 9, weight: "semibold", color: C.indigo });
    doc.text(num, x, y);
    titleX = x + Math.max(doc.getTextWidth(num) + 3.2, 7.4);
  }
  setText(pdf, { size: 12, weight: "semibold", color: C.ink });
  doc.text(title.title, titleX, y);
  if (title.hint) {
    const hintX = titleX + doc.getTextWidth(title.title) + 3;
    setText(pdf, { size: 8.5, color: C.muted });
    doc.text(title.hint, hintX, y);
  }
  return lineHeight(12, 1.25);
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
 * Таблица с тёмной строкой заголовка (jspdf-autotable). Шрифты — Manrope
 * «normal» всех начертаний: синтетического bold у jsPDF нет. Переносит
 * строки на следующий лист в пределах области набора. Возвращает низ таблицы.
 */
export function dataTable(pdf: BrandPdf, options: DataTableOptions): number {
  const x = options.x ?? BRAND_PAGE.side;
  const width = options.width ?? BRAND_PAGE.contentW;
  const size = options.fontSize ?? 8.5;
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
      cellPadding: { top: 2, bottom: 2, left: 2.6, right: 2.6 },
      lineColor: [...C.border] as [number, number, number],
      lineWidth: { bottom: 0.2 },
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: {
      font: pdf.faces.semibold.family,
      fontStyle: "normal",
      fontSize: size - 0.5,
      fillColor: [...C.ink] as [number, number, number],
      textColor: [...C.white] as [number, number, number],
      cellPadding: { top: 2.6, bottom: 2.6, left: 2.6, right: 2.6 },
      lineWidth: 0,
    },
    alternateRowStyles: options.zebra === false ? undefined : { fillColor: [...C.soft] as [number, number, number] },
    columnStyles: options.columnStyles,
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
  stroke(pdf, C.grid, 0.2);
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
  cell("Банк получателя", x, y + 10.4, { size: 6.5, color: C.muted });
  cell(`ИНН ${seller.inn || "—"}`, x, y + rowH * 2 + 4.9, { size: 8.5 });
  cell(`КПП ${seller.kpp || "—"}`, half, y + rowH * 2 + 4.9, { size: 8.5 });
  cell(seller.nameShort || "—", x, y + rowH * 3 + 5, { size: 8.5, weight: "semibold" });
  cell("Получатель", x, y + rowH * 3 + 9.6, { size: 6.5, color: C.muted });
  cell("БИК", col1, y + 4.9, { size: 8.5, color: C.ink2 });
  cell("Сч. №", col1, y + rowH + 4.9, { size: 8.5, color: C.ink2 });
  cell("Сч. №", col1, y + rowH * 2 + 4.9, { size: 8.5, color: C.ink2 });
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
  setText(pdf, { size: 8.5, color: C.ink2 });
  const postLines = doc.splitTextToSize(options.post, width) as string[];
  doc.text(postLines, x, y + 3);
  y += postLines.length * lineHeight(8.5, 1.3) + 9;
  const lineW = Math.min(36, width * 0.45);
  stroke(pdf, C.faint, 0.25);
  doc.line(x, y, x + lineW, y);
  setText(pdf, { size: 9, weight: "semibold", color: C.ink });
  doc.text(`/ ${options.name}`, x + lineW + 2, y - 0.6);
  setText(pdf, { size: 6.5, color: C.faint });
  doc.text("подпись", x + lineW / 2, y + 3, { align: "center" });
  if (options.stampLabel !== false) doc.text("М.П.", x + 2, y + 9);
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
  fill(pdf, C.ink);
  stroke(pdf, hex("7C8BF8"), 0.5);
  doc.circle(x + 5.8, y + 5.8, 5.6, "FD");
  setText(pdf, { size: 10, weight: "semibold", color: C.white });
  doc.text(initials || "WS", x + 5.8, y + 7.3, { align: "center" });
  const tx = x + 15;
  setText(pdf, { size: 9, color: C.muted });
  doc.text("С уважением,", tx, y + 3);
  setText(pdf, { size: 12.5, weight: "semibold", color: C.ink });
  doc.text(sender.name, tx, y + 9);
  setText(pdf, { size: 8.5, color: C.muted });
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

/**
 * Поток набора: абзацы с выключкой по ширине (вручную — word spacing jsPDF
 * не работает со шрифтами Identity-H), перенос на новый лист в пределах
 * `BRAND_CONTENT_TOP…BRAND_CONTENT_BOTTOM`.
 */
export class BrandFlow {
  y: number;
  readonly x: number;
  readonly width: number;

  constructor(
    readonly pdf: BrandPdf,
    options: { x?: number; width?: number; y?: number } = {},
  ) {
    this.x = options.x ?? BRAND_PAGE.side;
    this.width = options.width ?? BRAND_PAGE.contentW;
    this.y = options.y ?? BRAND_CONTENT_TOP;
  }

  get remaining(): number {
    return BRAND_CONTENT_BOTTOM - this.y;
  }

  newPage(): void {
    this.pdf.doc.addPage();
    this.y = BRAND_CONTENT_TOP;
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

  /** Разбивка на строки; первая строка может быть короче (после номера пункта). */
  layout(text: string, style: TextStyle, width: number, firstLineWidth = width): Word[][] {
    setText(this.pdf, style);
    const space = this.pdf.doc.getTextWidth(" ");
    const lines: Word[][] = [];
    let current: Word[] = [];
    let currentWidth = 0;
    for (const word of this.words(text, style)) {
      const limit = lines.length === 0 ? firstLineWidth : width;
      const next = current.length ? currentWidth + space + word.width : word.width;
      if (current.length && next > limit) {
        lines.push(current);
        current = [word];
        currentWidth = word.width;
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
    const leadStyle: TextStyle = { size, weight: "semibold", color: C.ink };
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
