import assert from "node:assert/strict";
import test from "node:test";

import { HEALTH_CONFIRMATIONS, dayMarkFromEntry, healthDecision, isRealHygieneEntry } from "./health-qr";

const ALL = HEALTH_CONFIRMATIONS.map((item) => item.key);

/**
 * Подтверждения — ровно три графы формы Приложения №1 СанПиН
 * «Гигиенический журнал (сотрудники)»: подпись сотрудника об отсутствии
 * температуры выше 37, признаков инфекций (у него и в семье), заболеваний
 * верхних дыхательных путей и гнойничковых заболеваний кожи.
 */
test("три подтверждения — графы формы Приложения №1", () => {
  assert.deepEqual(ALL, ["temperature", "infection", "respiratorySkin"]);
  assert.match(HEALTH_CONFIRMATIONS[0].label, /температур.*37/);
  assert.match(HEALTH_CONFIRMATIONS[1].label, /инфекц.*сем/);
  assert.match(HEALTH_CONFIRMATIONS[2].label, /дыхательных.*гнойничк/);
});

test("все три подтверждены — «Здоров» (до допуска заведующей) и подпись в журнале здоровья", () => {
  const decision = healthDecision(ALL);
  assert.equal(decision.admitted, true);
  assert.deepEqual(decision.hygiene, { status: "healthy", temperatureAbove37: false });
  assert.deepEqual(decision.health, { signed: true, measures: null });
  assert.deepEqual(decision.complaints, []);
});

test("не подтверждена температура — «Отстранён», температура выше 37, жалоба в мерах", () => {
  const decision = healthDecision(ALL.filter((key) => key !== "temperature"));
  assert.equal(decision.admitted, false);
  assert.deepEqual(decision.hygiene, { status: "suspended", temperatureAbove37: true });
  assert.equal(decision.health.signed, false);
  assert.match(decision.health.measures ?? "", /температура выше 37/);
});

test("ничего не отмечено — три жалобы", () => {
  assert.equal(healthDecision([]).complaints.length, 3);
});

test("заготовка строки месяца — не отметка; сводка дня", () => {
  assert.equal(isRealHygieneEntry({ _autoSeeded: true }), false);
  assert.equal(isRealHygieneEntry({ status: "healthy" }), true);
  assert.deepEqual(dayMarkFromEntry({ status: "healthy", confirmedAt: "06:54" }, null), { state: "admitted", at: "06:54" });
  assert.deepEqual(dayMarkFromEntry({ _autoSeeded: true }, "отпуск"), { state: "absent", label: "отпуск" });
  assert.deepEqual(dayMarkFromEntry(null, null), { state: "missing" });
  assert.deepEqual(dayMarkFromEntry({ status: "day_off" }, null), { state: "absent", label: "выходной" });
});
