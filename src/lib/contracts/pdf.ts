import {
  BRAND_COLORS as C,
  BRAND_PAGE,
  BrandFlow,
  brandSeller,
  createBrandPdf,
  decoratePages,
  lineHeight,
  measurePartyRows,
  partyRows,
  SECTION_SIZE,
  sectionTitle,
  setText,
  signatureLine,
  textWidth,
} from "@/lib/brand-docs/pdf-kit";

import { NBSP } from "./format";
import type { ContractDocument } from "./template";
import type { ContractSeller } from "./types";

/**
 * PDF договора в фирменном стиле (кит `brand-docs`). Чистая функция от
 * собранного текста и картинок — без базы: её зовут `render.server.ts`
 * (выпущенный договор), предпросмотр черновика и тесты.
 */

/** Факсимиле и печать Исполнителя. Выключено в параметрах договора — передавайте null. */
export type ContractImages = { facsimile: Buffer | null; stamp: Buffer | null };

export type ContractPdfResult = { bytes: Buffer; pages: number };

const BODY = 9;
const SECTION_H = lineHeight(SECTION_SIZE, 1.25);
/** warn-bg / warn-fg дизайн-системы. */
const VOID_BG = [255, 244, 242] as const;
const VOID_FG = [161, 58, 50] as const;

export function renderContractPdf(document: ContractDocument, seller: ContractSeller, images: ContractImages): ContractPdfResult {
  const pdf = createBrandPdf({ title: `${document.title} № ${document.number}`, subject: "Договор оказания услуг WeSetup" });
  const { doc } = pdf;
  const flow = new BrandFlow(pdf);
  const x = BRAND_PAGE.side;
  const width = BRAND_PAGE.contentW;
  const brand = brandSeller(seller);

  // ── шапка документа — как в шаблоне 2026-11-07: крупный заголовок слева,
  // под ним предмет серым, ниже город и дата по краям между тонкими линиями.
  setText(pdf, { size: 22, weight: "semibold", color: C.ink });
  doc.text(`Договор №${NBSP}${document.number}`, x, flow.y + 7.4);
  flow.gap(11.6);
  setText(pdf, { size: 10.5, color: C.muted });
  doc.text(document.subtitle, x, flow.y + 3.4);
  flow.gap(6.4);
  doc.setDrawColor(...C.border2);
  doc.setLineWidth(0.2);
  doc.line(x, flow.y, x + width, flow.y);
  setText(pdf, { size: 9.5, color: C.ink2 });
  doc.text(document.city, x, flow.y + 5.6);
  doc.text(document.dateLong, x + width, flow.y + 5.6, { align: "right" });
  doc.line(x, flow.y + 8.6, x + width, flow.y + 8.6);
  flow.gap(13);

  const notice = document.voided
    ? { label: "Аннулирован — договор недействителен", bg: VOID_BG, fg: VOID_FG }
    : document.draft
      ? { label: "Проект — номер договора присвоится при выпуске", bg: C.tint2, fg: C.indigoDeep }
      : null;
  if (notice) {
    const w = textWidth(pdf, notice.label, { size: 7.5, weight: "semibold" }) + 8;
    doc.setFillColor(...notice.bg);
    doc.roundedRect(x, flow.y, w, 6, 3, 3, "F");
    setText(pdf, { size: 7.5, weight: "semibold", color: notice.fg });
    doc.text(notice.label, x + 4, flow.y + 4.1);
    flow.gap(9);
  }

  flow.paragraph(document.preamble, { size: BODY, after: 1.6 });

  // ── разделы
  const last = document.sections[document.sections.length - 1];
  for (const section of document.sections) {
    if (section === last) break;
    flow.ensure(SECTION_H + 4 + lineHeight(BODY, 1.42) * 2);
    flow.gap(3.6);
    sectionTitle(pdf, x, flow.y + 4.2, { num: section.num, title: section.title });
    flow.gap(SECTION_H + 2.4);
    for (const block of section.blocks) {
      if (block.kind === "clause") flow.paragraph(block.text, { size: BODY, lead: block.num });
      else flow.paragraph(block.text, { size: BODY, indent: 9, marker: block.marker, after: 0.6 });
    }
  }

  // ── реквизиты и подписи: две колонки, целиком на одном листе
  const colGap = 6;
  const colW = (width - colGap) / 2;
  const labelWidth = 27;
  const rowsH = Math.max(
    measurePartyRows(pdf, { width: colW, labelWidth, rows: document.requisites.seller, size: 8 }),
    measurePartyRows(pdf, { width: colW, labelWidth, rows: document.requisites.buyer, size: 8 }),
  );
  const signatureH = 34;
  flow.ensure(SECTION_H + 6 + 9 + rowsH + signatureH);
  flow.gap(3.6);
  sectionTitle(pdf, x, flow.y + 4.2, { num: last.num, title: last.title });
  flow.gap(SECTION_H + 3);

  const top = flow.y;
  const columns = [
    { x, title: "Исполнитель", rows: document.requisites.seller, sign: document.signatures.seller, seller: true },
    { x: x + colW + colGap, title: "Заказчик", rows: document.requisites.buyer, sign: document.signatures.buyer, seller: false },
  ];
  let bottom = top;
  for (const column of columns) {
    // Подзаголовок стороны — тем же кеглем, что разделы; под ним тёмная тонкая линия, как над таблицами.
    setText(pdf, { size: SECTION_SIZE, weight: "semibold", color: C.ink });
    doc.text(column.title, column.x, top + 4.6);
    doc.setDrawColor(...C.ink);
    doc.setLineWidth(0.3);
    doc.line(column.x, top + 7.2, column.x + colW, top + 7.2);
    const rowsBottom = partyRows(pdf, { x: column.x, y: top + 7.6, width: colW, labelWidth, rows: column.rows, size: 8 });
    bottom = Math.max(bottom, rowsBottom);
  }
  const signTop = bottom + 4;
  for (const column of columns) {
    signatureLine(pdf, {
      x: column.x,
      y: signTop,
      width: colW,
      post: column.sign.caption,
      name: column.sign.nameShort,
      facsimile: column.seller ? images.facsimile : null,
      stamp: column.seller ? images.stamp : null,
    });
  }

  // «страница N из M» — в подвале, как в образце; над подвалом — только отметка аннулирования.
  const pages = decoratePages(pdf, brand, {
    pageInFooter: true,
    pageLabel: document.voided ? () => `АННУЛИРОВАН  ·  ${document.runningTitle}` : null,
  });

  return { bytes: Buffer.from(doc.output("arraybuffer")), pages };
}
