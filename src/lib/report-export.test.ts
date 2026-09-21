import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReportTable,
  formatReportValue,
  REPORT_EMPTY_MESSAGE,
} from "./report-export";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

test("документные записи: дата, сотрудник и поля с подписями шаблона", () => {
  const table = buildReportTable({
    fields: [
      { key: "temperature", label: "Температура, °C", type: "number" },
      { key: "status", label: "Статус", type: "select", options: [{ value: "ok", label: "Норма" }] },
      { key: "unused", label: "Не встречается" },
    ],
    documentEntries: [
      { date: day("2026-09-02"), employeeName: "Петрова", data: { temperature: 4.5, status: "ok", comment: "всё хорошо" } },
      { date: day("2026-09-01"), employeeName: "Иванова", data: { temperature: 3 } },
    ],
    timeZone: "Europe/Moscow",
  });
  assert.deepEqual(table.headers, ["Дата", "Сотрудник", "Температура, °C", "Статус", "comment"]);
  assert.deepEqual(table.rows, [
    ["01.09.2026", "Иванова", "3", "", ""],
    ["02.09.2026", "Петрова", "4,5", "Норма", "всё хорошо"],
  ]);
  assert.equal(table.isEmpty, false);
});

test("пустые заготовки и служебные ключи не попадают в выгрузку", () => {
  const table = buildReportTable({
    fields: [],
    documentEntries: [
      { date: day("2026-09-01"), employeeName: "А", data: { _autoSeeded: true } },
      { date: day("2026-09-01"), employeeName: "Б", data: { note: "", list: [] } },
      { date: day("2026-09-01"), employeeName: "В", data: { checked: false, _source: "close-day" } },
    ],
    timeZone: "Europe/Moscow",
  });
  assert.deepEqual(table.headers, ["Дата", "Сотрудник", "checked"]);
  assert.deepEqual(table.rows, [["01.09.2026", "В", "Нет"]]);
});

test("за период ничего нет — isEmpty, текст сообщения задан", () => {
  const table = buildReportTable({ fields: [], documentEntries: [], timeZone: "UTC" });
  assert.equal(table.isEmpty, true);
  assert.deepEqual(table.rows, []);
  assert.equal(REPORT_EMPTY_MESSAGE, "За выбранный период записей нет");
});

test("легаси-записи добавляют участок и оборудование, ссылки-id скрыты", () => {
  const table = buildReportTable({
    fields: [
      { key: "equipmentId", label: "Оборудование", type: "equipment" },
      { key: "value", label: "Значение" },
    ],
    documentEntries: [],
    legacyEntries: [
      {
        createdAt: new Date("2026-09-01T07:30:00.000Z"),
        filledByName: "Иванова",
        areaName: "Цех",
        equipmentName: "Холодильник 1",
        data: { equipmentId: "cmabc", value: "ok" },
      },
    ],
    timeZone: "Europe/Moscow",
  });
  assert.deepEqual(table.headers, ["Дата", "Сотрудник", "Участок", "Оборудование", "Значение"]);
  assert.deepEqual(table.rows, [["01.09.2026 10:30", "Иванова", "Цех", "Холодильник 1", "ok"]]);
});

test("formatReportValue: даты, массивы, булевы", () => {
  assert.equal(formatReportValue("2026-09-05"), "05.09.2026");
  assert.equal(formatReportValue(["a", "", "b"]), "a, b");
  assert.equal(formatReportValue(true), "Да");
  assert.equal(formatReportValue(null), "");
});
