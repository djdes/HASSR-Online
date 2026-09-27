import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { amountInWords, formatRuDate } from "./build";
import { registerUnicodeFont } from "./pdf-font";
import type { ClosingDocumentDraft } from "./types";

/**
 * Универсальный передаточный документ, статус 2 (передаточный документ
 * (акт); счёт-фактура не составляется — продавец на УСН без НДС).
 * Форма — приложение к письму ФНС от 21.10.2013 № ММВ-20-3/96@.
 *
 * Лист A4 альбомный: у таблицы УПД пятнадцать граф, в портрете они не
 * читаются. Всё рисуется из снимка (`ClosingDocumentDraft`) — ни базы,
 * ни сети здесь нет, поэтому один и тот же снимок всегда даёт тот же PDF.
 *
 * Картинки подписи и печати — PNG с прозрачным фоном; вписываются в
 * фиксированные рамки с сохранением пропорций. В режиме образца
 * отсутствующая картинка рисуется пунктирной рамкой с подписью — так
 * ROOT видит, где она встанет, ещё до загрузки.
 */
export type ClosingImages = { facsimile: Buffer | null; stamp: Buffer | null };

const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 10;
const CONTENT_W = PAGE_W - MARGIN * 2;

const money = (value: number) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

/** Размер PNG из заголовка IHDR — чтобы вписать картинку, не искажая. */
export function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function fitInto(
  image: Buffer,
  box: { w: number; h: number }
): { w: number; h: number } {
  const size = pngSize(image);
  if (!size || size.width === 0 || size.height === 0) return box;
  const scale = Math.min(box.w / size.width, box.h / size.height);
  return { w: size.width * scale, h: size.height * scale };
}

export function renderClosingDocumentPdf(
  draft: ClosingDocumentDraft,
  images: ClosingImages,
  options: { sample?: boolean } = {}
): Buffer {
  // compress: потоки (в том числе вшитый шрифт ~0,7 МБ) уходят дефлейтом —
  // PDF летит вложением в каждое письмо после оплаты.
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const font = registerUnicodeFont(doc);
  doc.setFont(font, "normal");
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);

  // Жирного начертания нет (см. pdf-font.ts) — акцент даём кеглем.
  const bold = () => doc.setFont(font, "normal");
  const normal = () => doc.setFont(font, "normal");
  const size = (pt: number) => doc.setFontSize(pt);

  /** Картинка в рамку (x, y — левый верхний угол рамки), либо пунктир в образце. */
  const drawImage = (image: Buffer | null, x: number, y: number, box: { w: number; h: number }, label: string) => {
    if (image) {
      const fit = fitInto(image, box);
      doc.addImage(new Uint8Array(image), "PNG", x + (box.w - fit.w) / 2, y + (box.h - fit.h) / 2, fit.w, fit.h);
      return;
    }
    if (!options.sample) return;
    doc.setLineDashPattern([1, 1], 0);
    doc.rect(x, y, box.w, box.h);
    doc.setLineDashPattern([], 0);
    size(6);
    doc.setTextColor(120, 120, 120);
    doc.text(label, x + box.w / 2, y + box.h / 2 + 1, { align: "center" });
    doc.setTextColor(0, 0, 0);
  };

  const date = formatRuDate(draft.issuedAt);

  // ---- статус и заголовок
  doc.rect(MARGIN, MARGIN, 24, 15);
  size(8);
  bold();
  doc.text("Статус: 2", MARGIN + 2, MARGIN + 4.5);
  normal();
  size(5.5);
  doc.text("1 — счёт-фактура и передаточный", MARGIN + 2, MARGIN + 8);
  doc.text("документ (акт)", MARGIN + 2, MARGIN + 10.5);
  doc.text("2 — передаточный документ (акт)", MARGIN + 2, MARGIN + 13);

  bold();
  size(11);
  doc.text("УНИВЕРСАЛЬНЫЙ ПЕРЕДАТОЧНЫЙ ДОКУМЕНТ", PAGE_W / 2, MARGIN + 5, { align: "center" });
  size(9.5);
  doc.text(`Передаточный документ (акт) № ${draft.number} от ${date}`, PAGE_W / 2, MARGIN + 11, { align: "center" });
  normal();
  size(6.5);
  doc.text(
    "Счёт-фактура № ____ от ____ — не составляется: статус 2, продавец применяет УСН, НДС не облагается",
    PAGE_W / 2,
    MARGIN + 15.5,
    { align: "center" }
  );
  if (options.sample) {
    // Пометка образца — чёрная в рамке: красный на ч/б принтере выходил
    // обычным тёмным текстом и не бросался в глаза.
    const sampleText = "ОБРАЗЕЦ — покупатель и строки условные";
    size(8);
    bold();
    const sampleW = doc.getTextWidth(sampleText);
    // Рамка правым краем — по полю листа, текст — внутри неё.
    doc.text(sampleText, PAGE_W - MARGIN - 1.5, MARGIN + 4, { align: "right" });
    doc.setLineWidth(0.4);
    doc.rect(PAGE_W - MARGIN - sampleW - 3, MARGIN + 0.8, sampleW + 3, 4.4);
    doc.setLineWidth(0.2);
    normal();
  }

  // ---- реквизиты сторон
  const innKpp = (inn: string | null, kpp: string | null, ogrn?: string | null) => {
    // У ИП нет КПП — в бланке показываем ОГРНИП, чтобы строка не была пустой.
    if (!kpp && (ogrn ?? "").replace(/\D/g, "").length === 15) return `${inn ?? "—"} / ОГРНИП ${ogrn}`;
    return [inn ?? "—", kpp ?? ""].filter((v) => v.length > 0).join(" / ");
  };
  const lines: Array<[string, string]> = [
    ["Продавец (2)", draft.seller.name],
    ["Адрес (2а)", draft.seller.address ?? "—"],
    ["ИНН/КПП продавца (2б)", innKpp(draft.seller.inn, draft.seller.kpp, draft.seller.ogrn)],
    ["Грузоотправитель и его адрес (3)", "он же"],
    ["Грузополучатель и его адрес (4)", [draft.buyer.name, draft.buyer.address].filter(Boolean).join(", ")],
    ["К платёжно-расчётному документу (5)", draft.paymentDocument],
    ["Покупатель (6)", draft.buyer.name],
    ["Адрес (6а)", draft.buyer.address ?? "—"],
    ["ИНН/КПП покупателя (6б)", innKpp(draft.buyer.inn, draft.buyer.kpp)],
    ["Валюта: наименование, код (7)", "Российский рубль, 643"],
    ["Идентификатор госконтракта, договора (8)", "—"],
  ];
  let y = MARGIN + 20;
  const labelW = 66;
  const valueX = MARGIN + labelW + 2;
  const valueW = CONTENT_W - labelW - 2;
  size(7.5);
  for (const [label, value] of lines) {
    const wrapped = doc.splitTextToSize(value || "—", valueW) as string[];
    doc.text(label, MARGIN, y);
    doc.text(wrapped, valueX, y);
    // Подчёркивание значения — как в бланке.
    const height = wrapped.length * 3.0;
    doc.setDrawColor(150, 150, 150);
    doc.line(valueX, y + height - 2.2, valueX + valueW, y + height - 2.2);
    doc.setDrawColor(0, 0, 0);
    y += height + 0.6;
  }

  // ---- таблица
  const head = [
    [
      "№ п/п",
      "Наименование товара (описание выполненных работ, оказанных услуг), имущественного права",
      "Код вида товара",
      "Ед. изм.: код",
      "усл. обозн.",
      "Количество (объём)",
      "Цена (тариф) за единицу",
      "Стоимость без налога — всего",
      "В т. ч. сумма акциза",
      "Налоговая ставка",
      "Сумма налога",
      "Стоимость с налогом — всего",
      "Страна: код",
      "краткое наименование",
      "Рег. номер декларации на товары",
    ],
    ["А", "1", "1б", "2", "2а", "3", "4", "5", "6", "7", "8", "9", "10", "10а", "11"],
  ];
  const body = draft.lines.map((line, index) => [
    String(index + 1),
    line.title,
    "—",
    line.unitCode,
    line.unit,
    String(line.qty),
    money(line.priceRub),
    money(line.sumRub),
    "без акциза",
    "без НДС",
    "без НДС",
    money(line.sumRub),
    "—",
    "—",
    "—",
  ]);
  const foot = [
    ["", "Всего к оплате (9)", "", "", "", "", "", money(draft.totalRub), "X", "", "без НДС", money(draft.totalRub), "", "", ""],
  ];

  autoTable(doc, {
    startY: y + 1,
    margin: { left: MARGIN, right: MARGIN },
    head,
    body,
    foot,
    theme: "grid",
    styles: { font, fontSize: 6.5, cellPadding: 1, lineColor: [0, 0, 0], lineWidth: 0.15, textColor: [0, 0, 0], overflow: "linebreak", valign: "middle" },
    // Заливки — серые (ч/б принтеры), без сине-серого оттенка.
    headStyles: { fillColor: [236, 236, 236], fontStyle: "normal", halign: "center" },
    footStyles: { fillColor: [246, 246, 246], fontStyle: "normal" },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 82 },
      2: { cellWidth: 12, halign: "center" },
      3: { cellWidth: 11, halign: "center" },
      4: { cellWidth: 13, halign: "center" },
      5: { cellWidth: 14, halign: "right" },
      6: { cellWidth: 18, halign: "right" },
      7: { cellWidth: 21, halign: "right" },
      8: { cellWidth: 14, halign: "center" },
      9: { cellWidth: 13, halign: "center" },
      10: { cellWidth: 14, halign: "center" },
      11: { cellWidth: 21, halign: "right" },
      12: { cellWidth: 11, halign: "center" },
      13: { cellWidth: 16, halign: "center" },
      14: { cellWidth: 9, halign: "center" },
    },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;

  // Нижний блок с подписями должен уместиться целиком — иначе новая
  // страница. Верхних подписей «Руководитель / Главный бухгалтер» нет:
  // при статусе 2 это поля счёта-фактуры, они не заполняются.
  const BOTTOM_BLOCK_H = 60;
  if (y + BOTTOM_BLOCK_H > PAGE_H - MARGIN - 6) {
    doc.addPage();
    y = MARGIN;
  }

  size(7.5);
  doc.text(`Всего к оплате: ${money(draft.totalRub)} руб. (${amountInWords(draft.totalRub)})`, MARGIN, y);
  y += 5;

  size(7);
  doc.text(`Основание передачи (сдачи) / получения (приёмки) [8]: ${draft.basis}`, MARGIN, y);
  y += 3.6;
  doc.text("Данные о транспортировке и грузе [9]: —", MARGIN, y);
  y += 4.4;

  // ---- нижний блок: слева продавец, справа покупатель
  const colW = CONTENT_W / 2 - 3;
  const leftX = MARGIN;
  const rightX = MARGIN + CONTENT_W / 2 + 3;
  doc.setDrawColor(0, 0, 0);
  doc.line(leftX, y - 2, PAGE_W - MARGIN, y - 2);
  const blockTop = y;

  const headName = draft.seller.head?.name || "";
  const post = draft.seller.head?.post || "";

  /** Должность — линия подписи — ф.и.о.; текст занимает левые ~100 мм колонки. */
  const roleLine = (x: number, yy: number, postText: string, nameText: string, withImage: boolean) => {
    size(7);
    doc.text(postText || "____________", x, yy);
    size(5.5);
    doc.text("(должность)", x + 10, yy + 3);
    const sx = x + 48;
    doc.line(sx, yy + 0.5, sx + 28, yy + 0.5);
    doc.text("(подпись)", sx + 14, yy + 3, { align: "center" });
    size(7);
    doc.text(nameText || "____________", sx + 32, yy);
    size(5.5);
    doc.text("(ф.и.о.)", sx + 32 + 8, yy + 3);
    // Подпись сидит на линии: рамка 7 мм, из них 5 над линией — строка
    // над ней (заголовок или «Ответственный…») остаётся чистой.
    if (withImage) drawImage(images.facsimile, sx + 1, yy - 5, { w: 26, h: 7 }, "факсимиле");
  };

  let ly = blockTop + 2;
  size(7);
  doc.text("Товар (груз) передал / услуги, результаты работ, права сдал", leftX, ly);
  ly += 6;
  roleLine(leftX, ly, post, headName, true);
  ly += 6.5;
  size(7);
  doc.text(`Дата отгрузки, передачи (сдачи) [11]: ${date}`, leftX, ly);
  ly += 3.6;
  doc.text("Иные сведения об отгрузке, передаче [12]: —", leftX, ly);
  ly += 5;
  doc.text("Ответственный за правильность оформления факта хозяйственной жизни [13]:", leftX, ly);
  ly += 4.5;
  roleLine(leftX, ly, post, headName, true);
  ly += 6.5;
  size(6.5);
  const composerLines = doc.splitTextToSize(
    `Наименование экономического субъекта — составителя документа [14]: ${draft.seller.name}`,
    colW - 40
  ) as string[];
  doc.text(composerLines, leftX, ly);
  // Печать — в свободной правой части колонки, поверх строк, как на бумаге.
  drawImage(images.stamp, leftX + colW - 32, blockTop + 7, { w: 30, h: 30 }, "печать");
  size(6);
  doc.text("М.П.", leftX + colW - 17, blockTop + 41, { align: "center" });
  const leftBottom = ly + composerLines.length * 3;

  let ry = blockTop + 2;
  size(7);
  doc.text("Товар (груз) получил / услуги, результаты работ, права принял", rightX, ry);
  ry += 6;
  roleLine(rightX, ry, draft.buyer.head?.post ?? "", draft.buyer.head?.name ?? "", false);
  ry += 6.5;
  size(7);
  doc.text("Дата получения (приёмки) [16]: «____» ______________ 20___ г.", rightX, ry);
  ry += 3.6;
  doc.text("Иные сведения о получении, приёмке [17]: —", rightX, ry);
  ry += 5;
  doc.text("Ответственный за правильность оформления факта хозяйственной жизни [18]:", rightX, ry);
  ry += 4.5;
  roleLine(rightX, ry, draft.buyer.head?.post ?? "", draft.buyer.head?.name ?? "", false);
  ry += 6.5;
  size(6.5);
  const buyerLines = doc.splitTextToSize(
    `Наименование экономического субъекта — составителя документа [19]: ${draft.buyer.name}`,
    colW - 40
  ) as string[];
  doc.text(buyerLines, rightX, ry);
  size(6);
  doc.text("М.П.", rightX + colW - 17, blockTop + 41, { align: "center" });
  const rightBottom = ry + buyerLines.length * 3;

  doc.line(PAGE_W / 2, blockTop - 2, PAGE_W / 2, Math.max(leftBottom, rightBottom, blockTop + 44));

  // ---- подвал: откуда документ
  size(6);
  doc.setTextColor(110, 110, 110);
  doc.text(
    `Сформировано сервисом WeSetup ${formatRuDate(new Date())}. Документ подписан факсимиле; оригинал с собственноручной подписью или обмен через ЭДО — по запросу на support@wesetup.ru.`,
    MARGIN,
    PAGE_H - 5
  );
  doc.setTextColor(0, 0, 0);

  return Buffer.from(doc.output("arraybuffer"));
}
