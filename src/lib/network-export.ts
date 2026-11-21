/**
 * Выгрузка «Сети» в Excel и PDF (серия E, Р6): таблица страницы — за сегодня
 * или за 7/30 дней — одной моделью для обоих форматов. Чистые функции:
 * формат из адреса, имя файла и строки таблицы. Подписи приходят готовыми
 * (переводит маршрут), файл рисует `network-export.server.ts`.
 */

import type { NetworkPeriod, NetworkPeriodRow, NetworkPeriodTotals, PeriodStatus } from "@/lib/network-period";
import { periodPercent } from "@/lib/network-period";
import type { JournalDayStatus, NetworkOrgRow, NetworkTotals } from "@/lib/network-summary";

export const NETWORK_EXPORT_FORMATS = ["xlsx", "pdf"] as const;
export type NetworkExportFormat = (typeof NETWORK_EXPORT_FORMATS)[number];

export function parseNetworkExportFormat(raw: unknown): NetworkExportFormat | null {
  return raw === "xlsx" || raw === "pdf" ? raw : null;
}

/** «set-2026-11-21.xlsx», за период — «set-7d-2026-11-21.pdf» (день выгрузки по Москве). */
export function networkExportFileName(period: NetworkPeriod, format: NetworkExportFormat, dayKey: string): string {
  const prefix = period === "today" ? "set" : `set-${period}d`;
  return `${prefix}-${dayKey}.${format}`;
}

export type ExportCell = string | number | null;

/** Колонка: подпись, вид значения (текст, рубли, проценты, число) и ширина в Excel. */
export type ExportColumn = { header: string; kind: "text" | "rub" | "percent" | "count"; width: number };

export type NetworkExportTable = {
  title: string;
  /** Период строкой: «Сегодня, 21 ноября» / «14 — 20 ноября». */
  subtitle: string;
  columns: ExportColumn[];
  rows: ExportCell[][];
  totals: ExportCell[];
  /** Пояснение под таблицей (правило дня). */
  note: string | null;
  /** «Сформировано 21 ноября, 14:05». */
  generated: string;
  sheetName: string;
};

export type NetworkExportLabels = {
  title: string;
  sheetName: string;
  subtitle: string;
  generated: string;
  total: string;
  note: string | null;
  columns: {
    organization: string;
    journals: string;
    status: string;
    balance: string;
    trial: string;
    exchange: string;
    filledDays: string;
    percent: string;
    records: string;
  };
  /** «3 из 5». */
  ofValue: (done: number, total: number) => string;
  unknown: string;
  todayStatus: Record<JournalDayStatus, string>;
  periodStatus: Record<PeriodStatus, string>;
  /** Свои 14 дней строкой (дата уже отформатирована). */
  trial: (row: NetworkOrgRow) => string;
  /** Последний обмен строкой. */
  exchange: (row: NetworkOrgRow) => string;
  /** Пометки к названию: «текущая», «удаляется». */
  marks: (row: { current: boolean; deletionRequested: boolean }) => string[];
};

const nameWithMarks = (name: string, marks: string[]) => (marks.length ? `${name} (${marks.join(", ")})` : name);

/** Таблица «Сегодня»: журналы, статус, баланс, свои 14 дней, обмен. */
export function networkTodayTable(input: {
  rows: ReadonlyArray<NetworkOrgRow>;
  totals: NetworkTotals;
  labels: NetworkExportLabels;
}): NetworkExportTable {
  const { labels } = input;
  return {
    title: labels.title,
    subtitle: labels.subtitle,
    columns: [
      { header: labels.columns.organization, kind: "text", width: 36 },
      { header: labels.columns.journals, kind: "text", width: 16 },
      { header: labels.columns.status, kind: "text", width: 22 },
      { header: labels.columns.balance, kind: "rub", width: 16 },
      { header: labels.columns.trial, kind: "text", width: 22 },
      { header: labels.columns.exchange, kind: "text", width: 24 },
    ],
    rows: input.rows.map((row) => [
      nameWithMarks(row.name, labels.marks(row)),
      row.journals ? labels.ofValue(row.journals.done, row.journals.total) : labels.unknown,
      labels.todayStatus[row.journalStatus],
      row.balanceRub,
      labels.trial(row),
      labels.exchange(row),
    ]),
    totals: [labels.total, null, null, input.totals.balanceRub, null, null],
    note: labels.note,
    generated: labels.generated,
    sheetName: labels.sheetName,
  };
}

/** Таблица за период: дни с заполненными журналами, доля, статус, записи. */
export function networkPeriodTable(input: {
  rows: ReadonlyArray<NetworkPeriodRow>;
  totals: NetworkPeriodTotals;
  labels: NetworkExportLabels;
}): NetworkExportTable {
  const { labels } = input;
  return {
    title: labels.title,
    subtitle: labels.subtitle,
    columns: [
      { header: labels.columns.organization, kind: "text", width: 36 },
      { header: labels.columns.filledDays, kind: "text", width: 20 },
      { header: labels.columns.percent, kind: "percent", width: 14 },
      { header: labels.columns.status, kind: "text", width: 22 },
      { header: labels.columns.records, kind: "count", width: 16 },
    ],
    rows: input.rows.map((row) => [
      nameWithMarks(row.name, labels.marks(row)),
      row.stats ? labels.ofValue(row.stats.filledDays, row.stats.days) : labels.unknown,
      periodPercent(row.stats),
      labels.periodStatus[row.status],
      row.stats ? row.stats.records : null,
    ]),
    totals: [
      labels.total,
      labels.ofValue(input.totals.filledDays, input.totals.days),
      periodPercent(input.totals),
      null,
      input.totals.records,
    ],
    note: labels.note,
    generated: labels.generated,
    sheetName: labels.sheetName,
  };
}

/** Ячейка строкой — для PDF (числа уже с разделителями, если передан форматтер). */
export function exportCellText(
  cell: ExportCell,
  kind: ExportColumn["kind"],
  formatNumber: (value: number) => string,
): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell;
  if (!Number.isFinite(cell)) return "";
  if (kind === "rub") return `${formatNumber(cell)} ₽`;
  if (kind === "percent") return `${formatNumber(cell)}%`;
  return formatNumber(cell);
}
