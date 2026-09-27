import type { jsPDF } from "jspdf";
import autoTableBase, { type CellHookData, type MarginPaddingInput, type UserOptions } from "jspdf-autotable";

import { JOURNAL_FOOTER_TEXT_BAND_MM, JOURNAL_SHEET_MARGIN_MM } from "@/lib/pdf-journal-sheet";

/**
 * Единые правила таблиц печатных журналов (поверх jspdf-autotable).
 *
 * Все таблицы бланков идут через `journalAutoTable` — это одна точка, где
 * задаётся, как выглядит ячейка:
 *
 *   • поля таблицы, которых бланк не задал, — поля листа
 *     (`journalTableMargin`): autoTable по умолчанию ставил 14,1 мм со всех
 *     сторон, и продолжение таблицы на странице без шапки начиналось ниже
 *     верхнего поля листа;
 *   • текст ВСЕХ ячеек центрирован по вертикали (`valign: "middle"`):
 *     раньше autoTable по умолчанию ставил текст к верху ячейки, а часть
 *     таблиц — по центру, и в одной строке тексты «гуляли»;
 *   • рамки у ВСЕХ ячеек одной толщины `JOURNAL_LINE_WIDTH`, чёрные.
 *     Тема `grid` autoTable рисует шапку таблицы с `lineWidth: 0` — у
 *     таблиц без явной толщины заголовки столбцов печатались без рамок;
 *   • заголовки столбцов — жирным и по центру, на светло-сером фоне
 *     (без явного цвета тема красила шапку в бирюзовый с белым текстом).
 *     Ширины столбцов, переносы и высоты строк autoTable считает по
 *     ОБЫЧНОМУ начертанию — как было, пока «жирный» был тем же файлом, —
 *     поэтому вёрстка и число страниц не меняются. Жирным заголовок
 *     рисуется в момент отрисовки; если строка жирным шире ячейки, кегль
 *     этой ячейки чуть уменьшается (не меньше 80 %), чтобы текст не
 *     вылезал за рамку;
 *   • короткие значения (числа, даты, время, «+», «—», отметки до
 *     3 символов) — по центру столбца, если ВЕСЬ столбец из них состоит.
 *     Длинный текст остаётся слева, как задал бланк.
 *
 * Хуки бланка (`didParseCell`, `willDrawCell`) вызываются первыми —
 * правила применяются поверх них.
 */
export const JOURNAL_LINE_WIDTH = 0.2;

const BLACK: [number, number, number] = [0, 0, 0];
const HEAD_FILL: [number, number, number] = [242, 242, 242];
/** Минимальный множитель кегля жирного заголовка, который не влез. */
const MIN_HEAD_FONT_SCALE = 0.8;

/** «Короткое значение»: число/дата/время/температура/отметка. */
const SHORT_VALUE = /^[\d\s.,:;+\-−–—°%/()×xхХ~<>≤≥=CС]+$/;

/**
 * Поля таблицы бланка: заданные бланком стороны остаются, остальные —
 * поля листа. Сверху, слева и справа — `JOURNAL_SHEET_MARGIN_MM`; снизу —
 * поле листа плюс полоса под «СТР. X ИЗ N» (подпись страницы без шапки
 * стоит базовой линией на нижнем поле и не должна лечь на таблицу). Под QR
 * в углу нижнее поле поднимает `reserveJournalQrBottomMargin`.
 */
export function journalTableMargin(margin: MarginPaddingInput | undefined): MarginPaddingInput {
  const defaults = {
    top: JOURNAL_SHEET_MARGIN_MM,
    right: JOURNAL_SHEET_MARGIN_MM,
    bottom: JOURNAL_SHEET_MARGIN_MM + JOURNAL_FOOTER_TEXT_BAND_MM,
    left: JOURNAL_SHEET_MARGIN_MM,
  };
  // Число или массив — бланк задал все стороны сам.
  if (typeof margin === "number" || Array.isArray(margin)) return margin;
  if (!margin) return defaults;
  const vertical = typeof margin.vertical === "number" ? margin.vertical : undefined;
  const horizontal = typeof margin.horizontal === "number" ? margin.horizontal : undefined;
  return {
    top: margin.top ?? vertical ?? defaults.top,
    right: margin.right ?? horizontal ?? defaults.right,
    bottom: margin.bottom ?? vertical ?? defaults.bottom,
    left: margin.left ?? horizontal ?? defaults.left,
  };
}

export function isShortCellValue(text: string): boolean {
  const value = text.trim();
  if (!value) return true;
  if (value.length <= 3) return true;
  return value.length <= 20 && SHORT_VALUE.test(value);
}

function cellText(data: CellHookData): string {
  const text = data.cell.text;
  return Array.isArray(text) ? text.join("\n") : String(text ?? "");
}

/**
 * Жирное начертание заголовка на время отрисовки ячейки: шрифт ставится
 * прямо в документ (autoTable уже применил стиль ячейки до хука). Если
 * самая длинная строка жирным шире ячейки — кегль уменьшается.
 */
function applyBoldHeadFont(doc: jsPDF, data: CellHookData) {
  const cell = data.cell;
  const baseSize = cell.styles.fontSize;
  cell.styles.fontStyle = "bold";
  doc.setFont(cell.styles.font, "bold");
  doc.setFontSize(baseSize);
  const available = cell.width - cell.padding("left") - cell.padding("right");
  const lines = Array.isArray(cell.text) ? cell.text : [String(cell.text ?? "")];
  const widest = Math.max(0, ...lines.map((line) => doc.getTextWidth(line)));
  if (available > 0 && widest > available) {
    doc.setFontSize(baseSize * Math.max(MIN_HEAD_FONT_SCALE, available / widest));
  }
}

export function journalAutoTable(doc: jsPDF, options: UserOptions): void {
  const userDidParseCell = options.didParseCell;
  const userWillDrawCell = options.willDrawCell;
  /** Столбец тела → все значения короткие (однострочные). */
  const shortColumn = new Map<number, boolean>();

  autoTableBase(doc, {
    ...options,
    margin: journalTableMargin(options.margin),
    styles: {
      textColor: BLACK,
      lineColor: BLACK,
      ...options.styles,
      lineWidth: JOURNAL_LINE_WIDTH,
      valign: "middle",
    },
    headStyles: {
      fillColor: HEAD_FILL,
      textColor: BLACK,
      lineColor: BLACK,
      ...options.headStyles,
      lineWidth: JOURNAL_LINE_WIDTH,
      valign: "middle",
    },
    bodyStyles: { ...options.bodyStyles, lineWidth: JOURNAL_LINE_WIDTH, valign: "middle" },
    footStyles: { ...options.footStyles, lineWidth: JOURNAL_LINE_WIDTH, valign: "middle" },
    didParseCell: (data) => {
      userDidParseCell?.(data);
      const cellStyles = data.cell.styles;
      cellStyles.valign = "middle";
      // Рамка: число → единая толщина. Объект (свои рамки у ячейки)
      // бланк задал сознательно — не трогаем.
      if (typeof cellStyles.lineWidth === "number") cellStyles.lineWidth = JOURNAL_LINE_WIDTH;
      if (data.section === "head") {
        // Разметка — по обычному начертанию (см. комментарий к модулю).
        cellStyles.fontStyle = "normal";
        cellStyles.halign = "center";
        return;
      }
      if (data.section === "body" && data.cell.colSpan === 1) {
        const text = cellText(data);
        const short = !text.includes("\n") && isShortCellValue(text);
        const index = data.column.index;
        shortColumn.set(index, (shortColumn.get(index) ?? true) && short);
      }
    },
    willDrawCell: (data) => {
      const result = userWillDrawCell?.(data);
      if (data.section === "head") {
        applyBoldHeadFont(doc, data);
      } else if (
        // Все ячейки уже разобраны — известно, из чего состоит столбец.
        data.section === "body" &&
        data.cell.colSpan === 1 &&
        data.cell.styles.halign === "left" &&
        shortColumn.get(data.column.index) === true
      ) {
        data.cell.styles.halign = "center";
      }
      return result;
    },
  });
}
