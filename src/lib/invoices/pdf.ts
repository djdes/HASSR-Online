import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { registerUnicodeFont } from "@/lib/closing-documents/pdf-font";
import { pngSize } from "@/lib/closing-documents/pdf";

import { amountInWords, formatRuDate, type InvoiceDraft } from "./build";

/**
 * «Счёт на оплату» — привычный российский бланк: таблица реквизитов
 * банка получателя, поставщик/покупатель, строки, итог, сумма прописью,
 * подписи руководителя и бухгалтера. Портрет A4 — граф мало.
 * Всё из снимка, без базы; факсимиле и печать — если загружены.
 */
export type InvoiceImages = { facsimile: Buffer | null; stamp: Buffer | null };

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;

const money = (value: number) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

function fit(image: Buffer, box: { w: number; h: number }) {
  const size = pngSize(image);
  if (!size || !size.width || !size.height) return box;
  const scale = Math.min(box.w / size.width, box.h / size.height);
  return { w: size.width * scale, h: size.height * scale };
}

export function renderInvoicePdf(draft: InvoiceDraft, images: InvoiceImages): Buffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const font = registerUnicodeFont(doc);
  doc.setFont(font, "normal");
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  const size = (pt: number) => doc.setFontSize(pt);

  const drawImage = (image: Buffer | null, x: number, y: number, box: { w: number; h: number }) => {
    if (!image) return;
    const f = fit(image, box);
    doc.addImage(new Uint8Array(image), "PNG", x + (box.w - f.w) / 2, y + (box.h - f.h) / 2, f.w, f.h);
  };

  const seller = draft.seller;
  const bank = seller.bank ?? { name: "", bik: "", account: "", corrAccount: "" };
  const innKpp = (inn: string | null, kpp: string | null) => [inn ? `ИНН ${inn}` : null, kpp ? `КПП ${kpp}` : null].filter(Boolean).join(", ");

  // ---- реквизиты банка получателя
  autoTable(doc, {
    startY: MARGIN,
    margin: { left: MARGIN, right: MARGIN },
    theme: "grid",
    styles: { font, fontSize: 8, cellPadding: 1.4, lineColor: [0, 0, 0], lineWidth: 0.2, textColor: [0, 0, 0], valign: "middle" },
    columnStyles: { 0: { cellWidth: 52 }, 1: { cellWidth: 68 }, 2: { cellWidth: 16 }, 3: { cellWidth: 44 } },
    body: [
      [bank.name || "—", "", "БИК", bank.bik || "—"],
      [{ content: "Банк получателя", styles: { fontSize: 6.5, textColor: [90, 90, 90] } }, "", "Сч. №", bank.corrAccount || "—"],
      [`ИНН ${seller.inn ?? "—"}`, `КПП ${seller.kpp ?? "—"}`, "Сч. №", bank.account || "—"],
      [{ content: seller.name, colSpan: 2 }, "", ""],
      [{ content: "Получатель", colSpan: 2, styles: { fontSize: 6.5, textColor: [90, 90, 90] } }, "", ""],
    ],
    didParseCell: (data) => {
      // Ячейки-подписи «Банк получателя» / «Получатель» — без верхней
      // линии, чтобы читаться как подпись под значением.
      if (data.section === "body" && (data.row.index === 1 || data.row.index === 4) && data.column.index === 0) {
        data.cell.styles.lineWidth = { top: 0, right: 0.2, bottom: 0.2, left: 0.2 } as never;
      }
    },
  });

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;

  size(13);
  doc.text(`Счёт на оплату № ${draft.number} от ${formatRuDate(draft.issuedAt)}`, MARGIN, y);
  y += 2;
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  doc.setLineWidth(0.2);
  y += 7;

  size(8.5);
  const party = (label: string, p: typeof draft.seller) => {
    const text = [p.name, innKpp(p.inn, p.kpp), p.address].filter(Boolean).join(", ");
    const wrapped = doc.splitTextToSize(text, CONTENT_W - 44) as string[];
    doc.text(label, MARGIN, y);
    doc.text(wrapped, MARGIN + 44, y);
    y += wrapped.length * 4 + 2;
  };
  party("Поставщик (Исполнитель):", seller);
  party("Покупатель (Заказчик):", draft.buyer);
  doc.text("Основание:", MARGIN, y);
  doc.text(draft.basis, MARGIN + 44, y);
  y += 6;

  // ---- строки
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: "grid",
    head: [["№", "Товары (работы, услуги)", "Кол-во", "Ед.", "Цена", "Сумма"]],
    body: draft.lines.map((line, index) => [
      String(index + 1),
      line.title,
      String(line.qty),
      line.unit,
      money(line.priceRub),
      money(line.sumRub),
    ]),
    styles: { font, fontSize: 8.5, cellPadding: 1.6, lineColor: [0, 0, 0], lineWidth: 0.2, textColor: [0, 0, 0], overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: [236, 236, 236], fontStyle: "normal", halign: "center" },
    columnStyles: {
      0: { cellWidth: 9, halign: "center" },
      1: { cellWidth: 97 },
      2: { cellWidth: 16, halign: "right" },
      3: { cellWidth: 16, halign: "center" },
      4: { cellWidth: 21, halign: "right" },
      5: { cellWidth: 21, halign: "right" },
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;

  const totalsX = PAGE_W - MARGIN;
  size(9);
  doc.text(`Итого: ${money(draft.totalRub)}`, totalsX, y, { align: "right" });
  y += 4.5;
  doc.text("Без налога (НДС): —", totalsX, y, { align: "right" });
  y += 4.5;
  size(10);
  doc.text(`Всего к оплате: ${money(draft.totalRub)}`, totalsX, y, { align: "right" });
  y += 8;

  size(8.5);
  doc.text(`Всего наименований ${draft.lines.length}, на сумму ${money(draft.totalRub)} руб.`, MARGIN, y);
  y += 4.5;
  size(9.5);
  const words = amountInWords(draft.totalRub);
  doc.text(words.charAt(0).toUpperCase() + words.slice(1), MARGIN, y);
  y += 4;
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  doc.setLineWidth(0.2);
  y += 6;

  size(7.5);
  doc.setTextColor(70, 70, 70);
  const note = doc.splitTextToSize(
    `Оплата этого счёта означает согласие с условиями договора-оферты (wesetup.ru/oferta). Счёт действителен до ${formatRuDate(draft.dueAt)}. В назначении платежа укажите «Оплата по счёту № ${draft.number}». После поступления средств подписка продлевается автоматически, закрывающие документы появляются в кабинете: «Настройки → Подписка → История оплат». НДС не облагается — продавец применяет УСН.`,
    CONTENT_W
  ) as string[];
  doc.text(note, MARGIN, y);
  y += note.length * 3.4 + 8;
  doc.setTextColor(0, 0, 0);

  // ---- подписи
  const headName = seller.head?.name ?? "";
  const signature = (label: string, yy: number) => {
    size(9);
    doc.text(label, MARGIN, yy);
    const lineX = MARGIN + 34;
    doc.line(lineX, yy + 0.5, lineX + 38, yy + 0.5);
    size(6);
    doc.text("(подпись)", lineX + 19, yy + 3.2, { align: "center" });
    size(9);
    doc.text(headName, lineX + 44, yy);
    size(6);
    doc.text("(расшифровка)", lineX + 44 + 10, yy + 3.2);
    drawImage(images.facsimile, lineX + 3, yy - 6, { w: 30, h: 8 });
  };
  signature("Руководитель", y);
  y += 10;
  signature("Бухгалтер", y);
  // Печать — справа от подписей.
  drawImage(images.stamp, PAGE_W - MARGIN - 36, y - 24, { w: 34, h: 34 });
  size(6.5);
  doc.text("М.П.", PAGE_W - MARGIN - 19, y + 13, { align: "center" });

  size(6.5);
  doc.setTextColor(110, 110, 110);
  doc.text(`Сформировано сервисом WeSetup ${formatRuDate(new Date())}`, MARGIN, PAGE_H - 8);
  doc.setTextColor(0, 0, 0);

  return Buffer.from(doc.output("arraybuffer"));
}
