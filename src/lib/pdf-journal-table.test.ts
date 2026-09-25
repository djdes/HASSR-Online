import assert from "node:assert/strict";
import test from "node:test";
import { jsPDF } from "jspdf";

import {
  JOURNAL_FONT_NAME,
  registerJournalUnicodeFont,
  resolveJournalFontFiles,
} from "@/lib/pdf-journal-font";
import { JOURNAL_LINE_WIDTH, isShortCellValue, journalAutoTable } from "@/lib/pdf-journal-table";

test("у шрифта журналов настоящее жирное начертание с кириллицей", () => {
  const files = resolveJournalFontFiles();
  assert.ok(files.regular, "обычный шрифт найден");
  assert.ok(files.bold, "жирный шрифт найден");
  assert.notEqual(files.bold, files.regular);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  assert.equal(registerJournalUnicodeFont(doc), JOURNAL_FONT_NAME);
  const styles = doc.getFontList()[JOURNAL_FONT_NAME];
  assert.ok(styles.includes("bold") && styles.includes("normal"));

  // Жирный кириллический текст шире обычного — значит, это другой файл,
  // и глифы кириллицы в нём есть (иначе ширина была бы нулевой).
  const sample = "СИСТЕМА ХАССП Периодичность контроля";
  doc.setFontSize(10);
  doc.setFont(JOURNAL_FONT_NAME, "normal");
  const normalWidth = doc.getTextWidth(sample);
  doc.setFont(JOURNAL_FONT_NAME, "bold");
  const boldWidth = doc.getTextWidth(sample);
  assert.ok(normalWidth > 40, `обычный: ${normalWidth}`);
  assert.ok(boldWidth > normalWidth * 1.05, `жирный ${boldWidth} vs обычный ${normalWidth}`);
});

test("короткие значения ячеек", () => {
  for (const value of ["", "12", "+", "—", "01-04-2026", "10:30", "+4,5 °C", "75 %", "В"]) {
    assert.equal(isShortCellValue(value), true, value);
  }
  for (const value of ["Иванов Иван Иванович", "Горячий цех", "Норма"]) {
    assert.equal(isShortCellValue(value), false, value);
  }
});

test("таблица журнала: рамки у шапки, всё по центру по вертикали, заголовки жирные", () => {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const font = registerJournalUnicodeFont(doc);
  const seen: Array<{
    section: string;
    column: number;
    lineWidth: unknown;
    valign: string;
    halign: string;
    fontStyle: string;
    fontSize: number;
  }> = [];
  journalAutoTable(doc, {
    theme: "grid",
    // Как у старых бланков: без lineWidth, с valign "top" у ячейки.
    styles: { font, fontSize: 9 },
    head: [["№", "Ф.И.О. сотрудника", "Температура"]],
    body: [
      ["1", { content: "Иванов Иван Иванович", styles: { valign: "top" } }, "+4"],
      ["2", "Петров Пётр Петрович", "—"],
    ],
    margin: { left: 10, right: 10 },
    didDrawCell: (data) => {
      seen.push({
        section: data.section,
        column: data.column.index,
        lineWidth: data.cell.styles.lineWidth,
        valign: data.cell.styles.valign,
        halign: data.cell.styles.halign,
        fontStyle: data.cell.styles.fontStyle,
        fontSize: data.cell.styles.fontSize,
      });
    },
  });

  const head = seen.filter((cell) => cell.section === "head");
  const body = seen.filter((cell) => cell.section === "body");
  assert.equal(head.length, 3);
  assert.equal(body.length, 6);
  for (const cell of seen) {
    assert.equal(cell.lineWidth, JOURNAL_LINE_WIDTH, `${cell.section}:${cell.column}`);
    assert.equal(cell.valign, "middle", `${cell.section}:${cell.column}`);
  }
  for (const cell of head) {
    assert.equal(cell.fontStyle, "bold");
    assert.equal(cell.halign, "center");
  }
  // «№» и температура — короткие значения → по центру; ФИО — слева.
  assert.deepEqual(
    body.filter((cell) => cell.column !== 1).map((cell) => cell.halign),
    ["center", "center", "center", "center"]
  );
  assert.deepEqual(
    body.filter((cell) => cell.column === 1).map((cell) => cell.halign),
    ["left", "left"]
  );
});

test("заголовок жирным не меняет разметку и не вылезает за ячейку", () => {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const font = registerJournalUnicodeFont(doc);
  const drawn: Record<number, { text: string[]; size: number; style: string; fits: boolean }> = {};
  journalAutoTable(doc, {
    theme: "grid",
    styles: { font, fontSize: 9 },
    // Обычным «Наименование» влезает в 30 мм, жирным — нет.
    head: [["Наименование", "Примечание"]],
    body: [["", ""]],
    columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: "auto" } },
    margin: { left: 10, right: 10 },
    didDrawCell: (data) => {
      if (data.section !== "head") return;
      const available = data.cell.width - data.cell.padding("left") - data.cell.padding("right");
      drawn[data.column.index] = {
        text: data.cell.text,
        size: doc.getFontSize(),
        style: doc.getFont().fontStyle,
        fits: data.cell.text.every((line) => doc.getTextWidth(line) <= available + 0.01),
      };
    },
  });
  // Перенос — как у обычного начертания: слово целиком.
  assert.deepEqual(drawn[0].text, ["Наименование"]);
  assert.equal(drawn[0].style, "bold");
  assert.ok(drawn[0].size < 9 && drawn[0].size >= 9 * 0.8, `кегль ${drawn[0].size}`);
  assert.ok(drawn[0].fits);
  // Где жирный влезает — кегль прежний.
  assert.equal(drawn[1].size, 9);
  assert.equal(drawn[1].style, "bold");
});
