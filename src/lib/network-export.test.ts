import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";

import {
  exportCellText,
  networkExportFileName,
  networkPeriodTable,
  networkTodayTable,
  parseNetworkExportFormat,
  type NetworkExportLabels,
} from "./network-export";
import { renderNetworkPdf, renderNetworkXlsx } from "./network-export.server";
import { networkPeriodTotals, periodStatus, type NetworkPeriodRow } from "./network-period";
import { buildNetworkRows, networkTotals } from "./network-summary";

const labels: NetworkExportLabels = {
  title: "Сеть: сводка по организациям",
  sheetName: "Сеть",
  subtitle: "14 — 20 ноября",
  generated: "Сформировано 21 ноября, 10:00",
  total: "Итого",
  note: "Правило дня",
  columns: {
    organization: "Организация",
    journals: "Журналы сегодня",
    status: "Статус",
    balance: "Баланс",
    trial: "Свои 14 дней",
    exchange: "Обмен справочниками",
    filledDays: "Дни с заполненными журналами",
    percent: "Доля дней",
    records: "Записей журналов",
  },
  ofValue: (done, total) => `${done} из ${total}`,
  unknown: "—",
  todayStatus: { done: "все заполнены", partial: "заполнены не все", none: "не начаты", empty: "журналов нет", unknown: "не удалось посчитать" },
  periodStatus: { done: "каждый день", partial: "не каждый день", none: "ни одного дня", empty: "журналов нет", unknown: "не удалось посчитать" },
  trial: (row) => (row.trial.state === "locked" ? "закрыта" : "—"),
  exchange: (row) => (row.lastExchangeAt ? "был" : "не было"),
  marks: (row) => [...(row.current ? ["текущая"] : []), ...(row.deletionRequested ? ["удаляется"] : [])],
};

const periodRows: NetworkPeriodRow[] = [
  { id: "a", name: "Кафе «Ёлка»", current: true, deletionRequested: false, stats: { days: 7, filledDays: 5, keptDays: 7, records: 1234 }, status: "partial" },
  { id: "b", name: "Бар Б", current: false, deletionRequested: true, stats: { days: 3, filledDays: 3, keptDays: 3, records: 2 }, status: "done" },
  { id: "c", name: "Столовая", current: false, deletionRequested: false, stats: null, status: periodStatus(null) },
];

test("формат и имя файла", () => {
  assert.equal(parseNetworkExportFormat("xlsx"), "xlsx");
  assert.equal(parseNetworkExportFormat("pdf"), "pdf");
  assert.equal(parseNetworkExportFormat("csv"), null);
  assert.equal(parseNetworkExportFormat(undefined), null);
  assert.equal(networkExportFileName("today", "xlsx", "2026-11-21"), "set-2026-11-21.xlsx");
  assert.equal(networkExportFileName("7", "pdf", "2026-11-21"), "set-7d-2026-11-21.pdf");
  assert.equal(networkExportFileName("30", "xlsx", "2026-11-21"), "set-30d-2026-11-21.xlsx");
});

test("таблица за период: строки, пометки, несчитанная строка и итог", () => {
  const table = networkPeriodTable({ rows: periodRows, totals: networkPeriodTotals(periodRows), labels });
  assert.deepEqual(table.columns.map((column) => column.kind), ["text", "text", "percent", "text", "count"]);
  assert.deepEqual(table.rows[0], ["Кафе «Ёлка» (текущая)", "5 из 7", 71, "не каждый день", 1234]);
  assert.deepEqual(table.rows[1], ["Бар Б (удаляется)", "3 из 3", 100, "каждый день", 2]);
  assert.deepEqual(table.rows[2], ["Столовая", "—", null, "не удалось посчитать", null]);
  assert.deepEqual(table.totals, ["Итого", "8 из 10", 80, null, 1236]);
});

test("таблица «Сегодня»: журналы, статус, баланс и итог баланса", () => {
  const rows = buildNetworkRows({
    activeOrgId: "a",
    orgs: [
      { id: "a", name: "Кафе", balanceRub: 1500, deletionRequested: false },
      { id: "b", name: "Бар", balanceRub: 250, deletionRequested: false },
    ],
    journals: new Map([
      ["a", { done: 3, total: 5 }],
      ["b", null],
    ]),
    trials: [{ organizationId: "b", status: "locked", trialEndsAt: new Date("2026-11-10T21:00:00.000Z") }],
    exchanges: [],
  });
  const table = networkTodayTable({ rows, totals: networkTotals(rows), labels });
  assert.deepEqual(table.rows[0], ["Кафе (текущая)", "3 из 5", "заполнены не все", 1500, "—", "не было"]);
  assert.deepEqual(table.rows[1], ["Бар", "—", "не удалось посчитать", 250, "закрыта", "не было"]);
  assert.deepEqual(table.totals, ["Итого", null, null, 1750, null, null]);
});

test("ячейка строкой: рубли, проценты, пустые и нечисловые значения", () => {
  const plain = (value: number) => String(value);
  assert.equal(exportCellText(1500, "rub", plain), "1500 ₽");
  assert.equal(exportCellText(71, "percent", plain), "71%");
  assert.equal(exportCellText(2, "count", plain), "2");
  assert.equal(exportCellText(null, "count", plain), "");
  assert.equal(exportCellText(Number.NaN, "count", plain), "");
  assert.equal(exportCellText("текст", "rub", plain), "текст");
});

test("Excel открывается обратно: заголовок, строки с числами и итог", async () => {
  const table = networkPeriodTable({ rows: periodRows, totals: networkPeriodTotals(periodRows), labels });
  const buffer = await renderNetworkXlsx(table);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet("Сеть");
  assert.ok(sheet);
  const values = (row: number) => (sheet.getRow(row).values as unknown[]).slice(1);
  assert.equal(values(1)[0], "Сеть: сводка по организациям");
  assert.equal(values(2)[0], "14 — 20 ноября");
  assert.deepEqual(values(4), table.columns.map((column) => column.header));
  assert.deepEqual(values(5), ["Кафе «Ёлка» (текущая)", "5 из 7", 71, "не каждый день", 1234]);
  const totals = sheet.getRow(8);
  assert.deepEqual([1, 2, 3, 5].map((cell) => totals.getCell(cell).value), ["Итого", "8 из 10", 80, 1236]);
  assert.equal(totals.getCell(4).value, null);
  // Несчитанная строка — пустые ячейки, не нули.
  assert.equal(sheet.getRow(7).getCell(3).value, null);
});

test("PDF собирается с кириллическим шрифтом", () => {
  const table = networkPeriodTable({ rows: periodRows, totals: networkPeriodTotals(periodRows), labels });
  const pdf = renderNetworkPdf(table, (value) => new Intl.NumberFormat("ru-RU").format(value));
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(pdf.length > 10_000, `pdf size ${pdf.length}`);
  // DejaVu вшит — значит, кириллица не превратится в кракозябры.
  assert.match(pdf.toString("latin1"), /ClosingUnicode|DejaVu/);
});
