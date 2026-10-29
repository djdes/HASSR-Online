import {
  BRAND_COLORS as C,
  BRAND_PAGE,
  BrandFlow,
  brandSeller,
  createBrandPdf,
  decoratePages,
  eyebrow,
  lineHeight,
  measurePartyRows,
  partyRows,
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

  // ── шапка документа
  eyebrow(pdf, document.title, x, flow.y + 2.6);
  setText(pdf, { size: 7, color: C.faint });
  doc.text(`Редакция ${document.templateVersion}`, x + width, flow.y + 2.6, { align: "right" });
  flow.gap(6.4);

  setText(pdf, { size: 17, weight: "semibold", color: C.ink });
  const titleLines = doc.splitTextToSize(`${document.title} №${NBSP}${document.number}`, width) as string[];
  titleLines.forEach((line) => {
    doc.text(line, x, flow.y + lineHeight(17, 1.15) * 0.8);
    flow.gap(lineHeight(17, 1.15));
  });
  setText(pdf, { size: 9.5, color: C.muted });
  doc.text("на доступ к сервису электронных журналов WeSetup и сопутствующие услуги", x, flow.y + 3.4);
  flow.gap(7.6);

  setText(pdf, { size: 9.5, color: C.ink2 });
  doc.text(document.city, x, flow.y + 3.4);
  doc.text(document.dateLong, x + width, flow.y + 3.4, { align: "right" });
  flow.gap(5.6);
  doc.setDrawColor(...C.indigo);
  doc.setLineWidth(0.6);
  doc.line(x, flow.y, x + width, flow.y);
  flow.gap(4.2);

  const notice = document.voided
    ? { label: "АННУЛИРОВАН — договор недействителен", bg: VOID_BG, fg: VOID_FG }
    : document.draft
      ? { label: "ПРОЕКТ — номер договора присвоится при выпуске", bg: C.tint2, fg: C.indigoDeep }
      : null;
  if (notice) {
    const w = textWidth(pdf, notice.label, { size: 7.5, weight: "semibold" }) + 8;
    doc.setFillColor(...notice.bg);
    doc.roundedRect(x, flow.y, w, 6, 3, 3, "F");
    setText(pdf, { size: 7.5, weight: "semibold", color: notice.fg });
    doc.text(notice.label, x + 4, flow.y + 4.1);
    flow.gap(9);
  }

  flow.y = partyRows(pdf, {
    y: flow.y,
    labelWidth: 30,
    rows: [
      { label: "Исполнитель", value: requisitesLine(document.requisites.seller), strong: false },
      { label: "Заказчик", value: requisitesLine(document.requisites.buyer), strong: false },
    ],
  });
  flow.gap(4.4);

  flow.paragraph(document.preamble, { size: BODY, after: 1.6 });

  // ── разделы
  const last = document.sections[document.sections.length - 1];
  for (const section of document.sections) {
    if (section === last) break;
    flow.ensure(lineHeight(12, 1.25) + 4 + lineHeight(BODY, 1.42) * 2);
    flow.gap(3.6);
    sectionTitle(pdf, x, flow.y + 4.2, { num: section.num, title: section.title });
    flow.gap(lineHeight(12, 1.25) + 2.4);
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
  flow.ensure(lineHeight(12, 1.25) + 6 + 9 + rowsH + signatureH);
  flow.gap(3.6);
  sectionTitle(pdf, x, flow.y + 4.2, { num: last.num, title: last.title });
  flow.gap(lineHeight(12, 1.25) + 3);

  const top = flow.y;
  const columns = [
    { x, title: "Исполнитель", rows: document.requisites.seller, sign: document.signatures.seller, seller: true },
    { x: x + colW + colGap, title: "Заказчик", rows: document.requisites.buyer, sign: document.signatures.buyer, seller: false },
  ];
  let bottom = top;
  for (const column of columns) {
    doc.setFillColor(...C.ink);
    doc.roundedRect(column.x, top, colW, 7.2, 2, 2, "F");
    setText(pdf, { size: 8, weight: "semibold", color: C.white });
    doc.text(column.title.toUpperCase(), column.x + 3, top + 4.8, { charSpace: 0.35 });
    const rowsBottom = partyRows(pdf, { x: column.x, y: top + 8.4, width: colW, labelWidth, rows: column.rows, size: 8 });
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

  const pages = decoratePages(pdf, brand, {
    pageLabel: (page, total) => `${document.voided ? "АННУЛИРОВАН  ·  " : ""}${document.runningTitle}  ·  Стр.${NBSP}${page} из ${total}`,
    footnoteLeft: () => "Исполнитель ____________     Заказчик ____________",
  });

  return { bytes: Buffer.from(doc.output("arraybuffer")), pages };
}

/** «Общество …, ИНН 5018215599, КПП 501801001» — строка стороны в сводке над преамбулой. */
function requisitesLine(rows: ContractDocument["requisites"]["seller"]): string {
  const name = rows.find((row) => row.label === "Наименование")?.value ?? "";
  const ids = rows.find((row) => row.label.startsWith("ИНН"));
  if (!ids) return name;
  const labels = ids.label.split(" / ");
  const values = ids.value.split(" / ");
  const parts = labels.map((label, index) => `${label}${NBSP}${values[index] ?? ""}`);
  return [name, ...parts].join(", ");
}
