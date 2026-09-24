import assert from "node:assert/strict";
import test from "node:test";

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import {
  JOURNAL_QR_BOTTOM_RESERVE_MM,
  JOURNAL_QR_EDGE_MM,
  JOURNAL_QR_MIN_MODULE_MM,
  JOURNAL_QR_SIZE_MM,
  findJournalQrSpot,
  journalQrMatrix,
  reserveJournalQrBottomMargin,
  stampJournalQr,
  trackPdfInk,
} from "@/lib/pdf-journal-qr";

const URL_41 = "https://wesetup.ru/qj/cmf1abcdefghijklmnopqrstu/cleaning_ventilation_checklist/AbCdEfGhIjKl";

const spotParams = { pageWidth: 297, pageHeight: 210, size: 13, captionWidth: 25, captionHeight: 7.5 };

test("QR: пустая страница — правый нижний угол с отступом от края", () => {
  const spot = findJournalQrSpot({ ...spotParams, boxes: [] });
  assert.deepEqual(spot, {
    x: 297 - JOURNAL_QR_EDGE_MM - 13,
    y: 210 - JOURNAL_QR_EDGE_MM - 13,
    moved: false,
    bottomRow: true,
  });
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
    lines: ["Электронный журнал WeSetup", "Отсканируйте, чтобы заполнить с телефона"],
    fontName: "helvetica",
    tracker,
  });
  assert.equal(placements.length, 2);
  const [p1, p2] = placements;
  // A4 в jsPDF — 210,0015 × 297,0000 мм.
  assert.ok(Math.abs(p1.x - (210 - JOURNAL_QR_EDGE_MM - JOURNAL_QR_SIZE_MM)) < 0.01, `x=${p1.x}`);
  assert.ok(Math.abs(p1.y - (297 - JOURNAL_QR_EDGE_MM - JOURNAL_QR_SIZE_MM)) < 0.01, `y=${p1.y}`);
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
