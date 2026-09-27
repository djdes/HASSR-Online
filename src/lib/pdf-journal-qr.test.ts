import assert from "node:assert/strict";
import test from "node:test";

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import {
  JOURNAL_QR_BOTTOM_MM,
  JOURNAL_QR_BOTTOM_RESERVE_MM,
  JOURNAL_QR_DEFAULT_RIGHT_MARGIN_MM,
  JOURNAL_QR_MIN_MODULE_MM,
  JOURNAL_QR_SIZE_MM,
  findJournalQrSpot,
  journalQrBlockWidth,
  journalQrContentRight,
  journalQrFooterInset,
  journalQrMatrix,
  journalQrRightEdges,
  reserveJournalQrBottomMargin,
  stampJournalQr,
  trackPdfInk,
} from "@/lib/pdf-journal-qr";

const URL_41 = "https://wesetup.ru/qj/cmf1abcdefghijklmnopqrstu/cleaning_ventilation_checklist/AbCdEfGhIjKl";

const spotParams = { pageWidth: 297, pageHeight: 210, size: 13, captionWidth: 25, captionHeight: 7.5 };

test("QR: пустая страница — правый нижний угол на полях листа (справа и снизу одно поле)", () => {
  const spot = findJournalQrSpot({ ...spotParams, boxes: [] });
  assert.deepEqual(spot, {
    x: 297 - JOURNAL_QR_DEFAULT_RIGHT_MARGIN_MM - 13,
    y: 210 - JOURNAL_QR_BOTTOM_MM - 13,
    moved: false,
    bottomRow: true,
  });
  assert.equal(JOURNAL_QR_BOTTOM_MM, JOURNAL_QR_DEFAULT_RIGHT_MARGIN_MM, "нижнее поле = правому");
});

test("QR: угол занят подписью — сдвиг влево по нижнему полю", () => {
  const spot = findJournalQrSpot({ ...spotParams, boxes: [{ x0: 260, y0: 190, x1: 295, y1: 205 }] });
  assert.ok(spot);
  assert.equal(spot.bottomRow, true);
  assert.equal(spot.moved, true);
  assert.ok(spot.x + 13 + 1.5 <= 260, `QR правее занятого: x=${spot.x}`);
});

test("QR: нижнее поле занято целиком — QR выше, в свободном месте", () => {
  const spot = findJournalQrSpot({ ...spotParams, boxes: [{ x0: 0, y0: 150, x1: 297, y1: 210 }] });
  assert.ok(spot);
  assert.equal(spot.bottomRow, false);
  assert.ok(spot.y + 13 + 1.5 <= 150, `QR не над занятой полосой: y=${spot.y}`);
});

test("QR: места нет нигде — null (вызывающий знает о наложении)", () => {
  assert.equal(findJournalQrSpot({ ...spotParams, boxes: [{ x0: 0, y0: 0, x1: 297, y1: 210 }] }), null);
});

test("QR: плотность — самый длинный код журнала ≤ 41 модуля, модуль ≥ 0,3 мм", () => {
  const qr = journalQrMatrix(URL_41);
  assert.ok(qr.modules.size <= 41, `модулей ${qr.modules.size}`);
  assert.ok(JOURNAL_QR_SIZE_MM / qr.modules.size >= JOURNAL_QR_MIN_MODULE_MM - 1e-9);
});

test("учёт чернил: текст, ячейки и контур записываются по страницам; stop() снимает обёртки", () => {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const originalText = doc.text;
  const tracker = trackPdfInk(doc);
  assert.notEqual(doc.text, originalText, "обёртка стоит");
  doc.setFontSize(10);
  doc.text("Подпись справа", 200, 280, { align: "right" });
  doc.addPage("a4", "landscape");
  doc.rect(10, 10, 100, 50, "F");
  doc.rect(0, 0, 297, 210); // рамка листа — только контур
  doc.line(5, 100, 50, 100);

  const p1 = tracker.boxes(1);
  assert.equal(p1.length, 1);
  assert.ok(p1[0].x1 <= 200.01 && p1[0].x0 < 200 - 10, "правое выравнивание учтено");
  assert.ok(p1[0].y0 < 280 && p1[0].y1 > 280);

  const p2 = tracker.boxes(2);
  assert.ok(p2.some((b) => b.x0 === 10 && b.y0 === 10 && b.x1 === 110 && b.y1 === 60), "заливка — целиком");
  // Рамка листа не занимает середину страницы.
  const middle = { x0: 140, y0: 90, x1: 160, y1: 95 };
  assert.ok(!p2.some((b) => b.x0 < middle.x1 && middle.x0 < b.x1 && b.y0 < middle.y1 && middle.y0 < b.y1));

  tracker.stop();
  assert.equal(doc.text, originalText, "обёртка снята");
  doc.text("после stop", 20, 20);
  assert.equal(tracker.boxes(2).length, p2.length, "после stop не пишется");
});

test("нижнее поле таблиц под QR: полная таблица не заходит в угол", () => {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  reserveJournalQrBottomMargin(doc);
  let maxBottom = 0;
  autoTable(doc, {
    head: [["№", "Текст"]],
    body: Array.from({ length: 120 }, (_, i) => [String(i + 1), "строка"]),
    margin: { left: 10, right: 10 }, // без bottom — как у отрисовщиков журналов
    didDrawCell: (data) => {
      maxBottom = Math.max(maxBottom, data.cell.y + data.cell.height);
    },
  });
  assert.ok(doc.getNumberOfPages() > 1);
  assert.ok(maxBottom <= 297 - JOURNAL_QR_BOTTOM_RESERVE_MM + 0.01, `низ таблицы ${maxBottom}`);
});

test("штамп: QR на каждой странице (книжная и альбомная), матрица совпадает с адресом", () => {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const tracker = trackPdfInk(doc);
  doc.text("стр. 1", 20, 20);
  doc.addPage("a4", "landscape");
  // Занятый угол на второй странице.
  doc.rect(200, 185, 97, 25, "F");
  const placements = stampJournalQr(doc, {
    url: URL_41,
    lines: ["Заполнение электронного журнала", "wesetup.ru"],
    fontName: "helvetica",
    tracker,
  });
  assert.equal(placements.length, 2);
  const [p1, p2] = placements;
  // A4 в jsPDF — 210,0015 × 297,0000 мм. На стр. 1 только текст слева —
  // равняться не на что, QR встаёт по полю по умолчанию.
  assert.ok(
    Math.abs(p1.x - (210.0015 - JOURNAL_QR_DEFAULT_RIGHT_MARGIN_MM - JOURNAL_QR_SIZE_MM)) < 0.01,
    `x=${p1.x}`,
  );
  assert.ok(Math.abs(p1.y - (297 - JOURNAL_QR_BOTTOM_MM - JOURNAL_QR_SIZE_MM)) < 0.01, `y=${p1.y}`);
  assert.equal(p1.moved, false);
  assert.equal(p2.overlap, false);
  assert.equal(p2.moved, true);
  assert.ok(p2.block.x1 <= 200 || p2.block.y1 <= 185, "второй QR обошёл занятый угол");
  assert.equal(p1.modules, journalQrMatrix(URL_41).modules.size);
  // Штамп не учитывается как «чернила» бланка.
  assert.equal(tracker.boxes(1).length, 1);
});

test("штамп: слишком длинный адрес (полный токен) — ошибка, а не нечитаемый QR", () => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const longUrl = `https://wesetup.ru/journal-fill/${"x".repeat(25)}/hygiene?token=${"y".repeat(170)}`;
  assert.throws(() => stampJournalQr(doc, { url: longUrl, lines: [], fontName: "helvetica" }), /слишком плотный/);
});

test("QR вровень с правой границей таблицы: правый край QR = правый край содержимого", () => {
  // Таблица с полями 14 мм на альбомном листе: правая граница 297 − 14.
  const tableRight = 297 - 14;
  const spot = findJournalQrSpot({
    ...spotParams,
    rightEdge: tableRight,
    boxes: [{ x0: 14, y0: 20, x1: tableRight, y1: 150 }],
  });
  assert.ok(spot);
  assert.equal(spot.moved, false);
  assert.ok(Math.abs(spot.x + 13 - tableRight) < 1e-9, `правый край QR ${spot.x + 13}`);
  assert.equal(spot.y, 210 - JOURNAL_QR_BOTTOM_MM - 13);
});

test("граница содержимого: максимум правых краёв, пусто — поле по умолчанию, не за зоной непечати", () => {
  assert.equal(journalQrContentRight([], 297), 297 - JOURNAL_QR_DEFAULT_RIGHT_MARGIN_MM);
  assert.equal(
    journalQrContentRight([{ x0: 10, y0: 10, x1: 30, y1: 20 }], 297),
    297 - JOURNAL_QR_DEFAULT_RIGHT_MARGIN_MM,
    "содержимое только слева — не равняемся на него",
  );
  assert.equal(
    journalQrContentRight(
      [
        { x0: 10, y0: 10, x1: 273, y1: 20 },
        { x0: 10, y0: 30, x1: 283.1, y1: 150 },
      ],
      297,
    ),
    283.1,
  );
  // Таблица шире листа (за зоной непечати) не считается — равняемся на шапку.
  assert.equal(
    journalQrContentRight(
      [
        { x0: 10, y0: 10, x1: 287.1, y1: 60 },
        { x0: 10, y0: 70, x1: 310, y1: 90 },
      ],
      297,
    ),
    287.1,
  );
  assert.equal(journalQrContentRight([{ x0: 0, y0: 0, x1: 297.2, y1: 210 }], 297), 297 - JOURNAL_QR_DEFAULT_RIGHT_MARGIN_MM);
});

test("штамп: QR вровень с таблицей на каждой странице (поля 10, 14 и 24 мм), нумерация левее QR", () => {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const tracker = trackPdfInk(doc);
  const margins = [10, 14, 24];
  margins.forEach((margin, index) => {
    if (index > 0) doc.addPage("a4", "landscape");
    autoTable(doc, {
      head: [["№", "Текст"]],
      body: Array.from({ length: 5 }, (_, i) => [String(i + 1), "строка"]),
      margin: { left: margin, right: margin },
      tableLineWidth: 0.2,
    });
  });
  const edges = journalQrRightEdges(doc, tracker);
  const lines = ["Заполнение электронного журнала", "wesetup.ru"];
  const placements = stampJournalQr(doc, { url: URL_41, lines, fontName: "helvetica", tracker, rightEdges: edges });
  assert.equal(placements.length, 3);
  placements.forEach((p, index) => {
    const tableRight = 297 - margins[index];
    assert.ok(Math.abs(p.x + p.size - tableRight) <= 0.5, `стр. ${index + 1}: QR ${p.x + p.size}, таблица ${tableRight}`);
    assert.equal(p.moved, false);
    // «СТР. X ИЗ N» кончается левее блока QR (с подписью).
    const inset = journalQrFooterInset(doc, lines, "helvetica", 297 - edges[index]);
    assert.ok(297 - inset <= p.block.x0 - 2, `стр. ${index + 1}: подпись страницы ${297 - inset}, блок QR ${p.block.x0}`);
  });
  assert.ok(journalQrBlockWidth(doc, lines, "helvetica") > JOURNAL_QR_SIZE_MM);
});
