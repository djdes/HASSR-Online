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
  drawFramedQr,
  drawPng,
  fitText,
  setText,
  type BrandPdf,
  type BrandSeller,
  type TextStyle,
} from "@/lib/brand-docs/pdf-kit";

import { shortPersonName } from "@/lib/contracts/format";

import { INVOICE_AFTER_PAYMENT, TOPUP_INVOICE_LINE_TITLE, amountInWords, formatRuDate, type InvoiceDraft } from "./build";

/**
 * «Счёт на оплату» в стиле шаблонов «WeSetup - шаблоны (без покупателя,
 * новый стиль)» (2026-11-07): белый бланк кита, сетка реквизитов банка
 * тонкими светлыми линиями с назначением платежа и платёжным QR в рамке
 * (ГОСТ Р 56042-2014: приложение банка подставит реквизиты, сумму и
 * назначение), крупный заголовок с датой строкой ниже, поставщик/покупатель/
 * основание через тонкие линии, таблица строк без тёмной шапки, итоги под
 * «Ценой» и «Суммой», сумма прописью, подписи руководителя и бухгалтера —
 * строки подписи одной длины друг под другом, с факсимиле и печатью.
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

  // Назначение платежа — на светлом фоне, как в шаблоне.
  doc.setFillColor(...C.soft);
  doc.rect(x, y + r * 3 + r * 1.4, width, purposeH, "F");
  doc.setDrawColor(...C.border2);
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
  txt(pdf, "БИК", xs[2] + 2.5, y + 5, { ...value, color: C.muted });
  txt(pdf, bank.bik || "—", xs[3] + 2.5, y + 5, value);
  txt(pdf, "Сч. №", xs[2] + 2.5, y + r + 5, { ...value, color: C.muted });
  txt(pdf, bank.corrAccount || "—", xs[3] + 2.5, y + r + 5, value);
  txt(pdf, `ИНН${NBSP}${draft.seller.inn ?? "—"}`, x + 2.5, y + r * 2 + 5, value);
  txt(pdf, `КПП${NBSP}${draft.seller.kpp ?? "—"}`, xs[1] + 2.5, y + r * 2 + 5, value);
  txt(pdf, "Сч. №", xs[2] + 2.5, y + r * 2 + 5, { ...value, color: C.muted });
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

  // ── согласие с договором — мелкой строкой по левому краю
  txt(pdf, `Оплата этого счёта означает согласие с условиями ${invoiceAgreementPhrase(draft.basis)}.`, X, y + 2.6, { size: 7.5, color: C.muted });
  y += 6.4;

  // ── реквизиты банка и платёжный QR справа
  // QR — во всю ширину своей колонки, правый край ровно по краю набора; подпись — по центру под ним.
  const payload = invoicePaymentPayload(draft);
  const qrColumn = payload ? 42 : 0;
  const gridBottom = bankGrid(pdf, draft, brand.nameShort || draft.seller.name, X, y, W - qrColumn);
  let qrBottom = gridBottom;
  if (payload) {
    const size = qrColumn - 4;
    const qx = X + W - size;
    drawFramedQr(pdf, payload, { x: qx, y, size }, { ecc: "M" });
    const caption = wrap(pdf, "Отсканируйте в приложении банка — реквизиты и сумма подставятся сами.", size, { size: 7.5 });
    txt(pdf, caption, qx + size / 2, y + size + 4, { size: 7.5, color: C.muted }, "center");
    qrBottom = y + size + 4 + caption.length * lh(7.5, 1.3);
  }
  y = Math.max(gridBottom, qrBottom) + 12;

  // ── заголовок: номер крупно, дата строкой ниже
  txt(pdf, `Счёт на оплату № ${draft.number}`, X, y, { size: 22, weight: "semibold" });
  y += 7.4;
  txt(pdf, `от ${longDate(draft.issuedAt)}`, X, y, { size: 10.5, color: C.muted });
  y += 6;

  // ── стороны и основание
  const partyLine = (p: InvoiceDraft["seller"], phone?: string | null) =>
    [p.name, p.inn ? `ИНН${NBSP}${p.inn}` : null, p.kpp ? `КПП${NBSP}${p.kpp}` : null, p.address, phone ? `тел. ${phone}` : null].filter(Boolean).join(", ");
  const hairline = (color = C.border) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.2);
    doc.line(X, y, X + W, y);
  };
  hairline(C.border2);
  for (const [label, value] of [
    ["Поставщик:", partyLine(draft.seller, brand.phone || null)],
    ["Покупатель:", partyLine(draft.buyer)],
    ["Основание:", draft.basis],
  ] as const) {
    const rows = wrap(pdf, value, W - 34, { size: 9.5 });
    y += 2.2 + lh(9.5) * 0.78;
    txt(pdf, label, X, y, { size: 9.5, color: C.muted });
    txt(pdf, rows, X + 34, y, { size: 9.5 });
    y += (rows.length - 1) * lh(9.5) + lh(9.5) * 0.22 + 2.2;
    hairline();
  }
  y += 6;

  // ── строки
  y = dataTable(pdf, {
    startY: y,
    zebra: false,
    fontSize: 9.5,
    head: [[
      "№",
      "Наименование услуги",
      { content: "Кол-во", styles: { halign: "center" } },
      { content: "Ед.", styles: { halign: "center" } },
      { content: "Цена", styles: { halign: "right" } },
      { content: "Сумма", styles: { halign: "right" } },
    ]],
    body: draft.lines.map((line, index) => [String(index + 1), line.title, String(line.qty), line.unit, money(line.priceRub), money(line.sumRub)]),
    columnStyles: {
      0: { cellWidth: 9, halign: "left", textColor: [...C.muted] as [number, number, number] },
      1: { cellWidth: 90 },
      2: { cellWidth: 16, halign: "center" },
      3: { cellWidth: 18, halign: "center" },
      4: { cellWidth: 26, halign: "right" },
      5: { cellWidth: 27, halign: "right" },
    },
  });
  y += 4;

  // ── итоги — под колонками «Цена» и «Сумма»: подписи по правому краю «Цены», суммы — по правому краю набора
  ensure(40);
  const sumW = 27;
  const priceRight = X + W - sumW - 2.6;
  const labelX = priceRight - 48;
  const totalRow = (label: string, value: string, big = false) => {
    const h = big ? 10 : 6.4;
    if (big) {
      doc.setDrawColor(...C.ink);
      doc.setLineWidth(0.3);
      doc.line(labelX, y + 1.2, X + W, y + 1.2);
    }
    const base = y + h / 2 + (big ? 2.2 : 1.2);
    txt(pdf, label, priceRight, base, big ? { size: 11.5, weight: "semibold" } : { size: 9.5, color: C.muted }, "right");
    txt(pdf, value, X + W, base, big ? { size: 11.5, weight: "semibold", color: C.indigoDeep } : { size: 9.5, weight: "semibold" }, "right");
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
    { size: 7.5, color: C.muted },
  );
  ensure(note.length * lh(7.5) + 40);
  txt(pdf, note, X, y, { size: 7.5, color: C.muted });
  y += note.length * lh(7.5) + 16;

  // ── подписи: должности в одной колонке, строки подписи одной длины друг под другом, расшифровка за ними
  const headName = shortPersonName(draft.seller.head?.name) ?? "";
  const lineX = X + 42;
  const signature = (label: string, name: string) => {
    txt(pdf, label, X, y, { size: 9.5, color: C.muted });
    doc.setDrawColor(...C.faint);
    doc.setLineWidth(0.25);
    doc.line(lineX, y + 0.6, lineX + 42, y + 0.6);
    if (name) txt(pdf, name, lineX + 45, y, { size: 9.5 });
    drawPng(pdf, images.facsimile, { x: lineX + 4, y: y - 7, w: 34, h: 9 });
  };
  signature("Руководитель", headName);
  drawPng(pdf, images.stamp, { x: lineX + 74, y: y - 14, w: 34, h: 34 });
  y += 13;
  signature("Главный бухгалтер", headName);
  if (images.stamp) txt(pdf, "М. П.", lineX + 91, y + 12, { size: 7.5, color: C.faint }, "center");

  decoratePages(pdf, brand, { pageLabel: doc.getNumberOfPages() > 1 ? undefined : null });
  return Buffer.from(doc.output("arraybuffer"));
}
