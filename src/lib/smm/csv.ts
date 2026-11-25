/**
 * Импорт плана из CSV (A20): «дата;время;текст;кнопка;ссылка;рубрика».
 * Разделитель — «;» или «,» (как сохранил Excel), текст в кавычках может
 * содержать переводы строк и разделители. Время — по Москве.
 */

export interface CsvPostRow {
  line: number;
  scheduledAt: Date | null;
  text: string;
  buttonText: string | null;
  buttonUrl: string | null;
  rubric: string | null;
  error?: string;
}

export function parseCsv(source: string): string[][] {
  const text = source.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function parseMoscow(date: string, time: string): Date | null {
  const d = date.trim();
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(d) ?? null;
  const iso = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  if (!iso) return null;
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim() || "10:00");
  if (!t) return null;
  const at = new Date(`${iso}T${t[1].padStart(2, "0")}:${t[2]}:00+03:00`);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function csvToPosts(source: string, now: Date = new Date()): CsvPostRow[] {
  const rows = parseCsv(source);
  const header = rows[0]?.map((c) => c.trim().toLowerCase()) ?? [];
  const hasHeader = header.includes("текст") || header.includes("text");
  return rows.slice(hasHeader ? 1 : 0).map((cells, index) => {
    const [date = "", time = "", text = "", buttonText = "", buttonUrl = "", rubric = ""] = cells;
    const line = index + (hasHeader ? 2 : 1);
    const scheduledAt = date.trim() ? parseMoscow(date, time) : null;
    const row: CsvPostRow = {
      line,
      scheduledAt,
      text: text.replace(/\r\n/g, "\n").trim(),
      buttonText: buttonText.trim() || null,
      buttonUrl: buttonUrl.trim() || null,
      rubric: rubric.trim() || null,
    };
    if (!row.text) row.error = "пустой текст";
    else if (row.text.length > 4000) row.error = "текст длиннее 4000 знаков";
    else if (date.trim() && !scheduledAt) row.error = "не понял дату (ДД.ММ.ГГГГ и ЧЧ:ММ)";
    else if (scheduledAt && scheduledAt.getTime() < now.getTime()) row.error = "время уже прошло";
    else if (row.buttonUrl && !/^https?:\/\//.test(row.buttonUrl)) row.error = "ссылка должна начинаться с https://";
    else if (!!row.buttonText !== !!row.buttonUrl) row.error = "у кнопки нужны и надпись, и ссылка";
    return row;
  });
}
