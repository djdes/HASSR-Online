import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateTransfer,
  buildLedger,
  computeMonth,
  daysInMonth,
  fillWeekdays,
  ledgerBalance,
  normalizeValues,
  parseCell,
  parseMoney,
  periodOfDate,
  remaining,
  shiftMonth,
  unpaidPeriods,
  weekday,
} from "./staff-timesheet";

test("ячейка: часы с шагом 0,25, статусы, пусто — стереть, мусор — ошибка", () => {
  assert.equal(parseCell("8"), 8);
  assert.equal(parseCell("7,5"), 7.5);
  assert.equal(parseCell(" б "), "Б");
  assert.equal(parseCell(""), undefined);
  assert.equal(parseCell("25"), null);
  assert.equal(parseCell("abc"), null);
  assert.equal(parseMoney("-500"), -500);
  assert.equal(parseMoney(""), 0);
  assert.equal(parseMoney("x"), null);
});

test("расчёт: 1–15 — аванс, 16–конец — расчёт; ставка 600 ₽/ч, премия и штраф", () => {
  const values = normalizeValues({ "1": 8, "15": 4, "16": 8, "20": "Б", "31": 2, p1: 1000, p2: -300, junk: 5 });
  const t = computeMonth(values, 600, "2026-11");
  assert.equal(daysInMonth("2026-11"), 30);
  // 31 ноября нет — день не считается.
  assert.deepEqual(t.period1, { hours: 12, earned: 7200, bonus: 1000, due: 8200 });
  assert.deepEqual(t.period2, { hours: 8, earned: 4800, bonus: -300, due: 4500 });
  assert.equal(t.due, 12700);
  assert.equal(t.statuses.Б, 1);
  assert.equal(remaining(8200, 5000), 3200);
  assert.equal(remaining(8200, 9000), 0);
});

test("календарь месяца", () => {
  assert.equal(weekday("2026-11", 11), 3); // среда
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
});

test("общий долг: все месяцы, старые периоды первыми, переплата уменьшает долг", () => {
  const ledger = buildLedger(
    [
      { month: "2026-11", values: { "2": 10 } },
      { month: "2026-10", values: { "1": 8, "20": 8 } },
    ],
    [
      { month: "2026-10", part: "advance", amountRub: 4800 },
      { month: "2026-10", part: "final", amountRub: 1000 },
    ],
    600,
  );
  assert.deepEqual(
    ledger.map((p) => [p.month, p.part, p.due, p.paid]),
    [
      ["2026-10", "advance", 4800, 4800],
      ["2026-10", "final", 4800, 1000],
      ["2026-11", "advance", 6000, 0],
    ],
  );
  assert.deepEqual(ledgerBalance(ledger), { due: 15600, paid: 5800, debt: 9800 });
  assert.deepEqual(unpaidPeriods(ledger).map((p) => p.left), [3800, 6000]);
});

test("перевод частями: гасит старые долги первыми, остаток — сверх долга", () => {
  const ledger = [
    { month: "2026-10", part: "final" as const, due: 4800, paid: 1000 },
    { month: "2026-11", part: "advance" as const, due: 6000, paid: 0 },
  ];
  assert.deepEqual(allocateTransfer(ledger, 5000), {
    parts: [
      { month: "2026-10", part: "final", amountRub: 3800 },
      { month: "2026-11", part: "advance", amountRub: 1200 },
    ],
    excess: 0,
  });
  assert.deepEqual(allocateTransfer(ledger, 2000).parts, [{ month: "2026-10", part: "final", amountRub: 2000 }]);
  assert.equal(allocateTransfer(ledger, 12000).excess, 2200);
  assert.deepEqual(periodOfDate("2026-11-15"), { month: "2026-11", part: "advance" });
  assert.deepEqual(periodOfDate("2026-11-16"), { month: "2026-11", part: "final" });
});

test("заполнить будни: только пустые будни до указанного дня", () => {
  // 2026-11: 1 — вс, 2 — пн, 7 — сб.
  const filled = fillWeekdays({ "3": 4, "4": "Б" }, "2026-11", 8, 9);
  assert.deepEqual(filled, { "2": 8, "3": 4, "4": "Б", "5": 8, "6": 8, "9": 8 });
});

test("переплата за один период гасит старые долги: периоды в сумме = общий долг", () => {
  const ledger = [
    { month: "2026-10", part: "final" as const, due: 5000, paid: 0 },
    { month: "2026-11", part: "advance" as const, due: 3000, paid: 4000 },
    { month: "2026-11", part: "final" as const, due: 2000, paid: 0 },
  ];
  const open = unpaidPeriods(ledger);
  assert.deepEqual(open.map((p) => [p.month, p.part, p.left]), [["2026-10", "final", 4000], ["2026-11", "final", 2000]]);
  assert.equal(open.reduce((sum, p) => sum + p.left, 0), ledgerBalance(ledger).debt);
  // Перевод на весь долг закрывает всё без остатка.
  assert.deepEqual(allocateTransfer(ledger, 6000).excess, 0);
});
