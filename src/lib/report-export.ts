/**
 * Сборка строк выгрузки журнала за период (/reports → PDF и Excel).
 *
 * Чистый модуль без Prisma: на вход — уже выбранные записи, на выход —
 * заголовки и строки таблицы. Раньше выгрузка читала только легаси
 * `JournalEntry`, а все журналы давно документные
 * (`JournalDocument` + `JournalDocumentEntry`) — файлы всегда выходили
 * пустыми, с одной строкой заголовков.
 */

import { isBlankEntryData } from "@/lib/journal-entry-blank";

export const REPORT_EMPTY_MESSAGE = "За выбранный период записей нет";

export type ReportField = {
  key: string;
  label?: string;
  type?: string;
  options?: Array<{ value: string; label: string }>;
};

/** Запись документного журнала (ячейка «сотрудник × день»). */
export type ReportDocumentEntry = {
  date: Date;
  employeeName: string | null;
  data: unknown;
};

/** Запись легаси-журнала (`JournalEntry`). */
export type ReportLegacyEntry = {
  createdAt: Date;
  filledByName: string | null;
  areaName: string | null;
  equipmentName: string | null;
  data: unknown;
};

export type ReportTable = {
  headers: string[];
  rows: string[][];
  /** true — за период ничего нет; строки пустые, файл пишет REPORT_EMPTY_MESSAGE. */
  isEmpty: boolean;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Дата записи документа — день без времени (полночь UTC). */
export function formatReportDay(date: Date): string {
  return `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

/** Дата и время в поясе организации (для легаси-записей). */
export function formatReportDateTime(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}`;
  } catch {
    return date.toISOString();
  }
}

/** Значение поля записи → текст ячейки. */
export function formatReportValue(value: unknown, field?: ReportField): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value).replace(".", ",") : "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (field?.options) {
      const option = field.options.find((item) => item.value === trimmed);
      if (option) return option.label;
    }
    if (ISO_DATE_RE.test(trimmed)) {
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) return formatReportDay(parsed);
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => formatReportValue(item, field))
      .filter((item) => item !== "")
      .join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !key.startsWith("_"))
      .map(([key, item]) => {
        const text = formatReportValue(item);
        return text === "" ? "" : `${key}: ${text}`;
      })
      .filter((item) => item !== "")
      .join("; ");
  }
  return String(value);
}

function asRecord(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return data as Record<string, unknown>;
}

/** Служебные ключи (`_autoSeeded`, `_source`…) в выгрузку не идут. */
function isServiceKey(key: string): boolean {
  return key.startsWith("_");
}

/**
 * Собирает таблицу выгрузки.
 *
 * Колонки: «Дата», «Сотрудник», затем поля записей — сначала в порядке
 * полей шаблона (с русскими подписями), потом ключи, которых в шаблоне
 * нет (подпись — сам ключ). Берутся только поля, которые встречаются
 * хотя бы в одной записи, чтобы не печатать десятки пустых столбцов.
 * Пустые заготовки (`{_autoSeeded:true}`, все поля пустые) пропускаются.
 */
export function buildReportTable(input: {
  fields: ReportField[];
  documentEntries: ReportDocumentEntry[];
  legacyEntries?: ReportLegacyEntry[];
  timeZone: string;
}): ReportTable {
  const fieldByKey = new Map<string, ReportField>();
  for (const field of input.fields) {
    if (field && typeof field.key === "string") fieldByKey.set(field.key, field);
  }

  const documentEntries = input.documentEntries
    .filter((entry) => !isBlankEntryData(entry.data))
    .sort((a, b) => {
      const byDate = a.date.getTime() - b.date.getTime();
      if (byDate !== 0) return byDate;
      return (a.employeeName ?? "").localeCompare(b.employeeName ?? "", "ru");
    });
  const legacyEntries = (input.legacyEntries ?? [])
    .filter((entry) => !isBlankEntryData(entry.data))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // Поля-ссылки (оборудование/сотрудник) хранят id — в таблице они
  // бессмысленны; сотрудник и оборудование идут отдельными колонками.
  const referenceKeys = new Set(
    input.fields
      .filter((field) => field?.type === "equipment" || field?.type === "employee")
      .map((field) => field.key)
  );

  const usedKeys = new Set<string>();
  const collectKeys = (data: unknown) => {
    for (const [key, value] of Object.entries(asRecord(data))) {
      if (isServiceKey(key) || referenceKeys.has(key)) continue;
      if (formatReportValue(value, fieldByKey.get(key)) === "") continue;
      usedKeys.add(key);
    }
  };
  documentEntries.forEach((entry) => collectKeys(entry.data));
  legacyEntries.forEach((entry) => collectKeys(entry.data));

  const orderedKeys: string[] = [];
  for (const field of input.fields) {
    if (!field || typeof field.key !== "string") continue;
    if (usedKeys.has(field.key) && !orderedKeys.includes(field.key)) {
      orderedKeys.push(field.key);
    }
  }
  for (const key of usedKeys) {
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  }

  const withLegacyColumns = legacyEntries.length > 0;
  const headers = ["Дата", "Сотрудник"];
  if (withLegacyColumns) headers.push("Участок", "Оборудование");
  for (const key of orderedKeys) {
    const label = fieldByKey.get(key)?.label?.trim();
    headers.push(label || key);
  }

  const valueCells = (data: unknown) => {
    const record = asRecord(data);
    return orderedKeys.map((key) =>
      formatReportValue(record[key], fieldByKey.get(key))
    );
  };

  const rows: string[][] = [];
  for (const entry of documentEntries) {
    const row = [formatReportDay(entry.date), entry.employeeName ?? ""];
    if (withLegacyColumns) row.push("", "");
    row.push(...valueCells(entry.data));
    rows.push(row);
  }
  for (const entry of legacyEntries) {
    rows.push([
      formatReportDateTime(entry.createdAt, input.timeZone),
      entry.filledByName ?? "",
      entry.areaName ?? "",
      entry.equipmentName ?? "",
      ...valueCells(entry.data),
    ]);
  }

  return { headers, rows, isEmpty: rows.length === 0 };
}
