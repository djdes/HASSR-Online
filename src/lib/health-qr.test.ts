import assert from "node:assert/strict";
import test from "node:test";

import { HEALTH_CONFIRMATIONS, dayMarkFromEntry, healthDecision, isRealHygieneEntry } from "./health-qr";

const ALL = HEALTH_CONFIRMATIONS.map((item) => item.key);

test("все пять подтверждений — допущен: «Здоров» и подпись в журнале здоровья", () => {
  const decision = healthDecision(ALL);
  assert.equal(decision.admitted, true);
  assert.deepEqual(decision.hygiene, { status: "healthy", temperatureAbove37: false });
  assert.deepEqual(decision.health, { signed: true, measures: null });
  assert.deepEqual(decision.complaints, []);
});

test("не отмечена температура — не допущен, «Отстранён», температура выше 37, жалоба в мерах", () => {
  const decision = healthDecision(ALL.filter((key) => key !== "temperature"));
  assert.equal(decision.admitted, false);
  assert.deepEqual(decision.hygiene, { status: "suspended", temperatureAbove37: true });
  assert.equal(decision.health.signed, false);
  assert.match(decision.health.measures ?? "", /повышенная температура/);
});

test("ничего не отмечено — все пять жалоб", () => {
  assert.equal(healthDecision([]).complaints.length, 5);
});

test("заготовка строки месяца — не отметка; сводка дня", () => {
  assert.equal(isRealHygieneEntry({ _autoSeeded: true }), false);
  assert.equal(isRealHygieneEntry({ status: "healthy" }), true);
  assert.deepEqual(dayMarkFromEntry({ status: "healthy", confirmedAt: "06:54" }, null), { state: "admitted", at: "06:54" });
  assert.deepEqual(dayMarkFromEntry({ _autoSeeded: true }, "отпуск"), { state: "absent", label: "отпуск" });
  assert.deepEqual(dayMarkFromEntry(null, null), { state: "missing" });
  assert.deepEqual(dayMarkFromEntry({ status: "day_off" }, null), { state: "absent", label: "выходной" });
});
