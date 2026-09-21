import assert from "node:assert/strict";
import test from "node:test";

import { buildGlassControlPdfRows } from "@/lib/glass-control-document";

const formatDate = (date: Date) => date.toISOString().slice(0, 10);
const resolveUserName = () => "Иванова И.И.";

test("пустая заготовка печатается пустой строкой", () => {
  const rows = buildGlassControlPdfRows({
    entries: [
      { date: new Date("2026-09-01T00:00:00Z"), employeeId: "u1", data: {} },
      {
        date: new Date("2026-09-02T00:00:00Z"),
        employeeId: "u1",
        data: { _autoSeeded: true },
      },
    ],
    formatDate,
    resolveUserName,
  });
  // Ни «V» в колонке «Нет», ни фамилии: контроль никто не проводил.
  assert.deepEqual(rows[0], ["2026-09-01", "", "", "", "", "", ""]);
  assert.deepEqual(rows[1], ["2026-09-02", "", "", "", "", "", ""]);
});

test("сохранённый осмотр без повреждений печатается как раньше", () => {
  const rows = buildGlassControlPdfRows({
    entries: [
      {
        date: new Date("2026-09-03T00:00:00Z"),
        employeeId: "u1",
        data: {
          damagesDetected: false,
          itemName: "",
          quantity: "",
          damageInfo: "",
        },
      },
    ],
    formatDate,
    resolveUserName,
  });
  assert.deepEqual(rows[0], [
    "2026-09-03",
    "",
    "V",
    "",
    "",
    "",
    "Иванова И.И.",
  ]);
});

test("повреждение печатается в колонке «Да» с описанием", () => {
  const rows = buildGlassControlPdfRows({
    entries: [
      {
        date: new Date("2026-09-04T00:00:00Z"),
        employeeId: "u1",
        data: {
          damagesDetected: true,
          itemName: "Лампа",
          quantity: "1",
          damageInfo: "Разбита, заменена",
        },
      },
    ],
    formatDate,
    resolveUserName,
  });
  assert.deepEqual(rows[0], [
    "2026-09-04",
    "V",
    "",
    "Лампа",
    "1",
    "Разбита, заменена",
    "Иванова И.И.",
  ]);
});
