import autoTable from "jspdf-autotable";

import { PT, brandAsset, createBrandPdf, drawPng, drawQr, fitText, setText, type BrandPdf, type BrandSeller, type RGB, type TextStyle } from "@/lib/brand-docs/pdf-kit";

import { shortPersonName } from "@/lib/contracts/format";

import { INVOICE_AFTER_PAYMENT, TOPUP_INVOICE_LINE_TITLE, amountInWords, formatRuDate, type InvoiceDraft } from "./build";

/**
 * «Счёт на оплату» обычной формы (образец владельца, 2026-11-09): как счёт
 * из учётной программы — чёрные линии, сетка реквизитов банка с назначением
 * платежа и платёжным QR (ГОСТ Р 56042-2014) справа, заголовок с номером и
 * датой над жирной чертой, поставщик / покупатель / основание, таблица
 * строк в рамке, итоги, сумма прописью, подписи руководителя и бухгалтера
 * с факсимиле и печатью. От фирменного стиля — только логотип вверху.
 *
 * Номер и суммы — из черновика (`buildInvoiceDraft`, номер = заказ), без базы.
 */

export type InvoiceImages = { facsimile: Buffer | null; stamp: Buffer | null };

export type InvoiceRenderOptions = {
  /** Реквизиты продавца для шапки (телефон, почта); нет — из снимка счёта. */
  brand?: BrandSeller | null;
};

const X = 15;
const W = 180;
const PAGE_TOP = 12;
const PAGE_BOTTOM = 297 - 14;
const NBSP = String.fromCharCode(0xa0);
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const money = (value: number) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value).replace(/\s/g, NBSP);

/** «29 октября 2026 г.» по Москве. */
function longDate(date: Date): string {
  const [d, m, y] = formatRuDate(date).split(".").map(Number);
  return `${d}${NBSP}${MONTHS[m - 1]} ${y}${NBSP}г.`;
}

/** «договора № WS-2026/0003 от 29.10.2026» / «договора-оферты (wesetup.ru/oferta)». */
export function invoiceAgreementPhrase(basis: string): string {
  const contract = /^Договор\s+(№.+)$/i.exec(basis.trim());
  if (contract) return `договора ${contract[1]}`;
  if (/оферт/i.test(basis)) return "договора-оферты (wesetup.ru/oferta)";
  return `«${basis.trim()}»`;
}

/** Назначение платежа — оно же уходит в платёжный QR (ГОСТ ограничивает 210 знаками). */
export function invoicePurpose(draft: Pick<InvoiceDraft, "number" | "issuedAt" | "lines">): string {
  const topup = draft.lines.some((line) => line.title === TOPUP_INVOICE_LINE_TITLE);
  const what = topup ? "пополнение баланса в сервисе WeSetup" : "доступ к сервису WeSetup";
  return `Оплата по счёту № ${draft.number} от ${formatRuDate(draft.issuedAt)} за ${what}. Без НДС`.slice(0, 210);
}

/** Строка платёжного QR «ST00012|…» (UTF-8); без полного банка — null. */
export function invoicePaymentPayload(draft: InvoiceDraft): string | null {
  const bank = draft.seller.bank;
  if (!bank || !/^\d{20}$/.test(bank.account) || !/^\d{9}$/.test(bank.bik) || !draft.seller.inn) return null;
  const clean = (value: string) => value.replace(/\|/g, " ").trim();
  return [
    "ST00012",
    `Name=${clean(draft.seller.name)}`,
    `PersonalAcc=${bank.account}`,
    `BankName=${clean(bank.name)}`,
    `BIC=${bank.bik}`,
    `CorrespAcc=${bank.corrAccount || "0"}`,
    `PayeeINN=${draft.seller.inn}`,
    ...(draft.seller.kpp ? [`KPP=${draft.seller.kpp}`] : []),
    `Sum=${Math.round(draft.totalRub * 100)}`,
    `Purpose=${clean(invoicePurpose(draft))}`,
  ].join("|");
}

const K: RGB = [0, 0, 0];
const THIN = 0.25;
const THICK = 0.6;
const TEXT = 9;
const LABEL = 6.5;

function txt(pdf: BrandPdf, value: string | string[], x: number, y: number, st: TextStyle, align: "left" | "right" | "center" = "left") {
  setText(pdf, { color: K, ...st });
  pdf.doc.text(value, x, y, { align });
}

function wrap(pdf: BrandPdf, value: string, width: number, st: TextStyle): string[] {
  setText(pdf, st);
  return pdf.doc.splitTextToSize(value, width) as string[];
}

const lh = (size: number, k = 1.35) => size * PT * k;

function rule(pdf: BrandPdf, x1: number, y1: number, x2: number, y2: number, width = THIN) {
  pdf.doc.setDrawColor(...K);
  pdf.doc.setLineWidth(width);
  pdf.doc.line(x1, y1, x2, y2);
}

/** Сетка «банк получателя / БИК / счёт / ИНН / КПП / получатель / назначение платежа». Возвращает низ. */
function bankGrid(pdf: BrandPdf, draft: InvoiceDraft, recipient: string, x: number, y: number, width: number): number {
  const bank = draft.seller.bank ?? { name: "", bik: "", account: "", corrAccount: "" };
  const r = 6.4;
  const valueW = 50;
  const labelW = 15;
  const x2 = x + width - valueW - labelW;
  const x3 = x + width - valueW;
  const xm = x + (x2 - x) / 2;
  const value: TextStyle = { size: TEXT };
  const label: TextStyle = { size: LABEL };
  const purpose = wrap(pdf, invoicePurpose(draft), width - 4, value);
  const purposeH = purpose.length * lh(TEXT) + 6.2;
  const gridBottom = y + r * 5;
  const bottom = gridBottom + purposeH;

  pdf.doc.setDrawColor(...K);
  pdf.doc.setLineWidth(THIN);
  pdf.doc.rect(x, y, width, bottom - y);
  rule(pdf, x2, y, x2, gridBottom);
  rule(pdf, x3, y, x3, gridBottom);
  rule(pdf, x2, y + r, x + width, y + r);
  rule(pdf, x, y + r * 2, x + width, y + r * 2);
  rule(pdf, x, y + r * 3, x2, y + r * 3);
  rule(pdf, xm, y + r * 2, xm, y + r * 3);
  rule(pdf, x, gridBottom, x + width, gridBottom);

  txt(pdf, fitText(pdf, bank.name || "—", x2 - x - 4, value), x + 2, y + 4.4, value);
  txt(pdf, "Банк получателя", x + 2, y + r * 2 - 1.4, label);
  txt(pdf, "БИК", x2 + 2, y + 4.4, value);
  txt(pdf, bank.bik || "—", x3 + 2, y + 4.4, value);
  txt(pdf, "Сч. №", x2 + 2, y + r + 4.4, value);
  txt(pdf, bank.corrAccount || "—", x3 + 2, y + r + 4.4, value);
  txt(pdf, `ИНН${NBSP}${NBSP}${draft.seller.inn ?? "—"}`, x + 2, y + r * 2 + 4.4, value);
  txt(pdf, `КПП${NBSP}${NBSP}${draft.seller.kpp ?? "—"}`, xm + 2, y + r * 2 + 4.4, value);
  txt(pdf, "Сч. №", x2 + 2, y + r * 2 + 4.4, value);
  txt(pdf, bank.account || "—", x3 + 2, y + r * 2 + 4.4, value);
  txt(pdf, fitText(pdf, recipient, x2 - x - 4, value), x + 2, y + r * 3 + 4.4, value);
  txt(pdf, "Получатель", x + 2, gridBottom - 1.4, label);
  txt(pdf, purpose, x + 2, gridBottom + 4.2, value);
  txt(pdf, "Назначение платежа", x + 2, bottom - 1.4, label);
  return bottom;
}

export function renderInvoicePdf(draft: InvoiceDraft, images: InvoiceImages, options: InvoiceRenderOptions = {}): Buffer {
  const pdf = createBrandPdf({ title: `Счёт на оплату № ${draft.number}`, subject: "Счёт на оплату WeSetup" });
  const { doc } = pdf;
  let y = PAGE_TOP;
  const ensure = (height: number) => {
    if (y + height > PAGE_BOTTOM) {
      doc.addPage();
      y = PAGE_TOP;
    }
  };

  // ── логотип
  const logo = drawPng(pdf, brandAsset("wordmark-polnoch.png"), { x: X, y, w: 34, h: 6.6 }, "left");
  if (!logo) txt(pdf, "WeSetup", X, y + 5.4, { size: 15, weight: "extrabold" });
  y += 12;

  // ── оплата = согласие с договором
  const agreement = wrap(pdf, `Оплата настоящего счёта означает согласие с условиями ${invoiceAgreementPhrase(draft.basis)}.`, W, { size: 7.5 });
  txt(pdf, agreement, X + W / 2, y, { size: 7.5 }, "center");
  y += agreement.length * lh(7.5) + 1.6;

  // ── реквизиты банка и платёжный QR справа
  const payload = invoicePaymentPayload(draft);
  const qrSize = 32;
  const qrColumn = payload ? qrSize + 6 : 0;
  const recipient = options.brand?.nameShort || draft.seller.name;
  const gridBottom = bankGrid(pdf, draft, recipient, X, y, W - qrColumn);
  let qrBottom = gridBottom;
  if (payload) {
    const qx = X + W - qrSize;
    drawQr(pdf, payload, { x: qx, y, size: qrSize }, { ecc: "M", color: K });
    const caption = wrap(pdf, "QR-код для оплаты в приложении банка", qrSize, { size: LABEL });
    txt(pdf, caption, qx + qrSize / 2, y + qrSize + 3.4, { size: LABEL }, "center");
    qrBottom = y + qrSize + 3.4 + caption.length * lh(LABEL);
  }
  y = Math.max(gridBottom, qrBottom) + 10;

  // ── заголовок над жирной чертой
  txt(pdf, `Счёт на оплату № ${draft.number} от ${longDate(draft.issuedAt)}`, X, y, { size: 14, weight: "semibold" });
  y += 2.6;
  rule(pdf, X, y, X + W, y, THICK);
  y += 2.4;

  // ── стороны и основание
  const partyLine = (p: InvoiceDraft["seller"], phone?: string | null) =>
    [p.name, p.inn ? `ИНН${NBSP}${p.inn}` : null, p.kpp ? `КПП${NBSP}${p.kpp}` : null, p.address, phone ? `тел. ${phone}` : null].filter(Boolean).join(", ");
  const labelW = 25;
  for (const [label, value] of [
    ["Поставщик:", partyLine(draft.seller, options.brand?.phone || null)],
    ["Покупатель:", partyLine(draft.buyer)],
    ["Основание:", draft.basis],
  ] as const) {
    const strong: TextStyle = { size: TEXT, weight: "semibold" };
    const rows = wrap(pdf, value, W - labelW, strong);
    y += lh(TEXT);
    txt(pdf, label, X, y, { size: TEXT });
    txt(pdf, rows, X + labelW, y, strong);
    y += (rows.length - 1) * lh(TEXT) + 1.4;
  }
  y += 3;

  // ── строки — таблица в рамке
  const cell = { lineColor: [0, 0, 0] as [number, number, number], lineWidth: THIN, textColor: [0, 0, 0] as [number, number, number] };
  autoTable(doc, {
    startY: y,
    margin: { left: X, right: 210 - X - W, top: PAGE_TOP, bottom: 297 - PAGE_BOTTOM },
    tableWidth: W,
    theme: "grid",
    tableLineColor: [0, 0, 0],
    tableLineWidth: 0.4,
    styles: { font: pdf.faces.regular.family, fontStyle: "normal", fontSize: TEXT, cellPadding: 1.4, valign: "middle", overflow: "linebreak", ...cell },
    headStyles: { font: pdf.faces.semibold.family, fontStyle: "normal", fontSize: TEXT, halign: "center", fillColor: [255, 255, 255], ...cell },
    head: [["№", "Наименование товаров, работ, услуг", "Коли-\nчество", "Ед. изм.", "Цена", "Сумма"]],
    body: draft.lines.map((line, index) => [String(index + 1), line.title, String(line.qty), line.unit, money(line.priceRub), money(line.sumRub)]),
    columnStyles: {
      0: { cellWidth: 9, halign: "center" },
      1: { cellWidth: 92 },
      2: { cellWidth: 16, halign: "center" },
      3: { cellWidth: 17, halign: "center" },
      4: { cellWidth: 23, halign: "right" },
      5: { cellWidth: 23, halign: "right" },
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // ── итоги под «Ценой» и «Суммой»
  ensure(46);
  const strongStyle: TextStyle = { size: TEXT, weight: "semibold" };
  for (const [label, value] of [
    ["Итого:", money(draft.totalRub)],
    ["Без налога (НДС):", "—"],
    ["Всего к оплате:", money(draft.totalRub)],
  ] as const) {
    y += lh(TEXT, 1.5);
    txt(pdf, label, X + W - 23 - 1.4, y, strongStyle, "right");
    txt(pdf, value, X + W - 1.4, y, strongStyle, "right");
  }
  y += 7;

  txt(pdf, `Всего наименований ${draft.lines.length}, на сумму ${money(draft.totalRub)} руб.`, X, y, { size: TEXT });
  y += lh(TEXT, 1.45);
  const words = amountInWords(draft.totalRub);
  const wordsRows = wrap(pdf, `${words.charAt(0).toUpperCase()}${words.slice(1)}, без налога (НДС).`, W, strongStyle);
  txt(pdf, wordsRows, X, y, strongStyle);
  y += wordsRows.length * lh(TEXT) + 2.4;

  // ── условия оплаты
  const terms = wrap(
    pdf,
    `Условия оплаты: 100${NBSP}% предоплата. Счёт действителен до ${formatRuDate(draft.dueAt)}. ${draft.afterPayment ?? INVOICE_AFTER_PAYMENT.subscription}`,
    W,
    { size: 8 },
  );
  ensure(terms.length * lh(8) + 40);
  txt(pdf, terms, X, y, { size: 8 });
  y += terms.length * lh(8) + 1;
  rule(pdf, X, y, X + W, y, THICK);
  y += 16;

  // ── подписи: должность, линия, расшифровка; факсимиле на линии, печать рядом
  const headName = shortPersonName(draft.seller.head?.name) ?? "";
  const lineX = X + 40;
  const signature = (label: string, name: string) => {
    txt(pdf, label, X, y, { size: TEXT });
    rule(pdf, lineX, y + 0.6, lineX + 48, y + 0.6);
    if (name) txt(pdf, name, lineX + 51, y, strongStyle);
    drawPng(pdf, images.facsimile, { x: lineX + 7, y: y - 7, w: 34, h: 9 });
  };
  signature("Руководитель", headName);
  drawPng(pdf, images.stamp, { x: lineX + 82, y: y - 14, w: 34, h: 34 });
  y += 13;
  signature("Главный бухгалтер", headName);
  if (images.stamp) txt(pdf, "М. П.", lineX + 99, y + 12, { size: LABEL }, "center");

  // ── подпись листа
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    txt(pdf, `Счёт на оплату № ${draft.number} от ${formatRuDate(draft.issuedAt)}, страница ${page} из ${total}`, X + W, 297 - 8, { size: LABEL }, "right");
  }
  return Buffer.from(doc.output("arraybuffer"));
}
