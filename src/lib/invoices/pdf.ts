import {
  BRAND_COLORS as C,
  BRAND_CONTENT_BOTTOM,
  BRAND_CONTENT_TOP,
  BRAND_PAGE,
  PT,
  brandSeller,
  createBrandPdf,
  dataTable,
  decoratePages,
  drawPng,
  drawQr,
  fitText,
  setText,
  type BrandPdf,
  type BrandSeller,
  type TextStyle,
} from "@/lib/brand-docs/pdf-kit";

import { shortPersonName } from "@/lib/contracts/format";

import { INVOICE_AFTER_PAYMENT, TOPUP_INVOICE_LINE_TITLE, amountInWords, formatRuDate, type InvoiceDraft } from "./build";

/**
 * «Счёт на оплату» в дизайне «WeSetup - КП и счета (новый дизайн)»
 * (2026-10-30): шапка и подвал-карточки, сетка реквизитов банка с
 * назначением платежа и платёжным QR (ГОСТ Р 56042-2014: приложение банка
 * подставит реквизиты, сумму и назначение), поставщик/покупатель/основание,
 * таблица строк с тёмной шапкой, итог «Без налога (НДС)», сумма прописью,
 * подписи руководителя и бухгалтера с факсимиле и печатью.
 *
 * Номер и суммы — из черновика (`buildInvoiceDraft`, номер = заказ), без базы.
 */
export type InvoiceImages = { facsimile: Buffer | null; stamp: Buffer | null };

export type InvoiceRenderOptions = {
  /** Реквизиты продавца для шапки (телефон, почта); нет — из снимка счёта. */
  brand?: BrandSeller | null;
};

const X = BRAND_PAGE.side;
const W = BRAND_PAGE.contentW;
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

function txt(pdf: BrandPdf, value: string | string[], x: number, y: number, st: TextStyle, align: "left" | "right" | "center" = "left") {
  setText(pdf, st);
  pdf.doc.text(value, x, y, { align });
}

function wrap(pdf: BrandPdf, value: string, width: number, st: TextStyle): string[] {
  setText(pdf, st);
  return pdf.doc.splitTextToSize(value, width) as string[];
}

const lh = (size: number, k = 1.4) => size * PT * k;

/** Сетка «банк получателя / ИНН / получатель / назначение платежа». Возвращает низ. */
function bankGrid(pdf: BrandPdf, draft: InvoiceDraft, recipient: string, x: number, y: number, width: number): number {
  const { doc } = pdf;
  const bank = draft.seller.bank ?? { name: "", bik: "", account: "", corrAccount: "" };
  const c = [36, 36, 16.5];
  const xs = [x, x + c[0], x + c[0] + c[1], x + c[0] + c[1] + c[2], x + width];
  const r = 7.6;
  const value: TextStyle = { size: 9.5 };
  const label: TextStyle = { size: 7.5, color: C.muted };
  const purpose = wrap(pdf, `${invoicePurpose(draft)}.`, width - 5, value);
  const purposeH = Math.max(r * 1.4, purpose.length * lh(9.5) + 6.4);
  const bottom = y + r * 2 + r + r * 1.4 + purposeH;

  doc.setDrawColor(...C.grid);
  doc.setLineWidth(0.2);
  doc.rect(x, y, width, bottom - y);
  // Вертикали верхних рядов и горизонтали.
  doc.line(xs[2], y, xs[2], y + r * 2 + r + r * 1.4);
  doc.line(xs[3], y, xs[3], y + r * 2 + r + r * 1.4);
  doc.line(xs[1], y + r * 2, xs[1], y + r * 3);
  doc.line(xs[2], y + r, xs[4], y + r);
  doc.line(x, y + r * 2, xs[4], y + r * 2);
  doc.line(x, y + r * 3, xs[2], y + r * 3);
  doc.line(x, y + r * 3 + r * 1.4, xs[4], y + r * 3 + r * 1.4);

  const bankName = bank.name || "—";
  txt(pdf, wrap(pdf, bankName, xs[2] - x - 5, value)[0] ?? bankName, x + 2.5, y + 5, value);
  txt(pdf, "Банк получателя", x + 2.5, y + 10.6, label);
  txt(pdf, "БИК", xs[2] + 2.5, y + 5, value);
  txt(pdf, bank.bik || "—", xs[3] + 2.5, y + 5, value);
  txt(pdf, "Сч. №", xs[2] + 2.5, y + r + 5, value);
  txt(pdf, bank.corrAccount || "—", xs[3] + 2.5, y + r + 5, value);
  txt(pdf, `ИНН${NBSP}${draft.seller.inn ?? "—"}`, x + 2.5, y + r * 2 + 5, value);
  txt(pdf, `КПП${NBSP}${draft.seller.kpp ?? "—"}`, xs[1] + 2.5, y + r * 2 + 5, value);
  txt(pdf, "Сч. №", xs[2] + 2.5, y + r * 2 + 5, value);
  txt(pdf, bank.account || "—", xs[3] + 2.5, y + r * 2 + 5, { size: 9.5, weight: "semibold" });
  txt(pdf, fitText(pdf, recipient, xs[2] - x - 5, value), x + 2.5, y + r * 3 + 4.8, value);
  txt(pdf, "Получатель", x + 2.5, y + r * 3 + 9, label);
  const py = y + r * 3 + r * 1.4;
  txt(pdf, purpose, x + 2.5, py + 5, value);
  txt(pdf, "Назначение платежа", x + 2.5, py + purposeH - 2.2, label);
  return bottom;
}

export function renderInvoicePdf(draft: InvoiceDraft, images: InvoiceImages, options: InvoiceRenderOptions = {}): Buffer {
  const pdf = createBrandPdf({ title: `Счёт на оплату № ${draft.number}`, subject: "Счёт на оплату WeSetup" });
  const { doc } = pdf;
  const brand =
    options.brand ??
    brandSeller({
      nameShort: draft.seller.name,
      nameFull: draft.seller.name,
      inn: draft.seller.inn ?? "",
      kpp: draft.seller.kpp ?? "",
      ogrn: draft.seller.ogrn ?? "",
      address: draft.seller.address ?? "",
      phone: "",
      email: "",
      head: draft.seller.head ?? { post: "", name: "" },
      bank: draft.seller.bank ?? { name: "", bik: "", account: "", corrAccount: "" },
    });
  let y = BRAND_CONTENT_TOP - 1.5;
  const ensure = (height: number) => {
    if (y + height > BRAND_CONTENT_BOTTOM) {
      doc.addPage();
      y = BRAND_CONTENT_TOP;
    }
  };

  // ── согласие с договором — мелко по центру
  txt(pdf, `Оплата этого счёта означает согласие с условиями ${invoiceAgreementPhrase(draft.basis)}.`, X + W / 2, y + 2.6, { size: 8, color: C.muted }, "center");
  y += 6.4;

  // ── реквизиты банка и платёжный QR справа
  const payload = invoicePaymentPayload(draft);
  const qrColumn = payload ? 42 : 0;
  const gridBottom = bankGrid(pdf, draft, brand.nameShort || draft.seller.name, X, y, W - qrColumn);
  if (payload) {
    const size = 32;
    const qx = X + W - size - 2;
    drawQr(pdf, payload, { x: qx, y, size }, { ecc: "M" });
    txt(pdf, wrap(pdf, "Отсканируйте в приложении банка — реквизиты и сумма подставятся сами.", qrColumn - 4, { size: 7.5 }), qx + size / 2, y + size + 4, { size: 7.5, color: C.muted }, "center");
  }
  y = Math.max(gridBottom, payload ? y + 46 : gridBottom) + 9;

  // ── заголовок с индиго-линией
  txt(pdf, `Счёт на оплату № ${draft.number} от ${longDate(draft.issuedAt)}`, X, y, { size: 16, weight: "semibold" });
  y += 3;
  doc.setDrawColor(...C.indigo);
  doc.setLineWidth(0.6);
  doc.line(X, y, X + W, y);
  y += 6.5;

  // ── стороны и основание
  const partyLine = (p: InvoiceDraft["seller"], phone?: string | null) =>
    [p.name, p.inn ? `ИНН${NBSP}${p.inn}` : null, p.kpp ? `КПП${NBSP}${p.kpp}` : null, p.address, phone ? `тел. ${phone}` : null].filter(Boolean).join(", ");
  for (const [label, value] of [
    ["Поставщик:", partyLine(draft.seller, brand.phone || null)],
    ["Покупатель:", partyLine(draft.buyer)],
    ["Основание:", draft.basis],
  ] as const) {
    const rows = wrap(pdf, value, W - 34, { size: 9.5 });
    txt(pdf, label, X, y, { size: 9.5, color: C.muted });
    txt(pdf, rows, X + 34, y, { size: 9.5 });
    y += rows.length * lh(9.5) + 2.6;
  }
  y += 2;

  // ── строки
  y = dataTable(pdf, {
    startY: y,
    zebra: false,
    fontSize: 9.5,
    head: [[
      { content: "№", styles: { halign: "center" } },
      "Наименование услуги",
      { content: "Кол-во", styles: { halign: "center" } },
      { content: "Ед.", styles: { halign: "center" } },
      { content: "Цена", styles: { halign: "right" } },
      { content: "Сумма", styles: { halign: "right" } },
    ]],
    body: draft.lines.map((line, index) => [String(index + 1), line.title, String(line.qty), line.unit, money(line.priceRub), money(line.sumRub)]),
    columnStyles: {
      0: { cellWidth: 9, halign: "center", textColor: [...C.muted] as [number, number, number] },
      1: { cellWidth: 90 },
      2: { cellWidth: 16, halign: "center" },
      3: { cellWidth: 18, halign: "center" },
      4: { cellWidth: 26, halign: "right" },
      5: { cellWidth: 27, halign: "right" },
    },
  });
  y += 4;

  // ── итоги
  ensure(40);
  const tx = X + W - 74;
  const totalRow = (label: string, value: string, big = false) => {
    const h = big ? 10 : 6.4;
    if (big) {
      doc.setFillColor(...C.tint);
      doc.rect(tx, y, 74, h, "F");
    }
    const base = y + h / 2 + (big ? 1.6 : 1.2);
    txt(pdf, label, tx + 40, base, { size: 9.5, weight: big ? "semibold" : "regular", color: big ? C.ink : C.ink2 }, "right");
    txt(pdf, value, X + W - 2.6, base, { size: big ? 12 : 9.5, weight: "semibold", color: big ? C.indigo : C.ink }, "right");
    y += h;
  };
  totalRow("Итого:", money(draft.totalRub));
  totalRow("Без налога (НДС):", "—");
  totalRow("Всего к оплате:", money(draft.totalRub), true);
  y += 7;

  txt(pdf, `Всего наименований ${draft.lines.length}, на сумму ${money(draft.totalRub)} руб.`, X, y, { size: 9.5 });
  y += lh(9.5, 1.5);
  const words = amountInWords(draft.totalRub);
  const wordsRows = wrap(pdf, `${words.charAt(0).toUpperCase()}${words.slice(1)}, без налога (НДС).`, W, { size: 9.5, weight: "semibold" });
  txt(pdf, wordsRows, X, y, { size: 9.5, weight: "semibold" });
  y += wordsRows.length * lh(9.5) + 3;

  const note = wrap(
    pdf,
    `Счёт действителен до ${formatRuDate(draft.dueAt)}. В назначении платежа укажите «Оплата по счёту № ${draft.number}». ${draft.afterPayment ?? INVOICE_AFTER_PAYMENT.subscription} НДС не облагается — продавец применяет УСН.`,
    W,
    { size: 8, color: C.muted },
  );
  ensure(note.length * lh(8) + 40);
  txt(pdf, note, X, y, { size: 8, color: C.muted });
  y += note.length * lh(8) + 2;
  doc.setDrawColor(...C.border2);
  doc.setLineWidth(0.2);
  doc.line(X, y, X + W, y);
  y += 13;

  // ── подписи: руководитель и бухгалтер, факсимиле на линии, печать рядом
  const headName = shortPersonName(draft.seller.head?.name) ?? "";
  const signature = (label: string) => {
    txt(pdf, label, X, y, { size: 9.5 });
    setText(pdf, { size: 9.5 });
    const lineX = X + doc.getTextWidth(label) + 3;
    doc.setDrawColor(...C.faint);
    doc.setLineWidth(0.25);
    doc.line(lineX, y + 0.6, lineX + 38, y + 0.6);
    if (headName) txt(pdf, headName, lineX + 41, y, { size: 9.5 });
    drawPng(pdf, images.facsimile, { x: lineX + 3, y: y - 7, w: 32, h: 9 });
    return lineX;
  };
  const lineX = signature("Руководитель");
  drawPng(pdf, images.stamp, { x: lineX + 70, y: y - 14, w: 34, h: 34 });
  y += 12;
  signature("Главный бухгалтер");
  if (images.stamp) txt(pdf, "М.П.", lineX + 87, y + 12, { size: 7, color: C.faint }, "center");

  decoratePages(pdf, brand, { pageLabel: doc.getNumberOfPages() > 1 ? undefined : null });
  return Buffer.from(doc.output("arraybuffer"));
}
