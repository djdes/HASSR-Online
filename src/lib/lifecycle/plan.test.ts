import assert from "node:assert/strict";
import test from "node:test";

import { dueTodayOrNextWorkday, isWorkday, mskDateKey, workdaysLeft } from "./calendar";
import { DEFAULT_LIFECYCLE_SETTINGS as S, normalizeLifecycleSettings, planLifecycle, suggestedDiscount, type LifecycleFacts } from "./plan";

/** Момент по Москве: «2026-11-12 06:15». */
const msk = (value: string) => new Date(`${value.replace(" ", "T")}:00+03:00`);

const trial = (overrides: Partial<LifecycleFacts> = {}): LifecycleFacts => ({
  key: "acc1",
  kind: "free_period",
  reason: null,
  trialEndsAt: msk("2026-11-18 00:00"),
  paidUntil: null,
  subscriptionEnd: null,
  seats: 12,
  recentEntries: 30,
  paysByInvoice: false,
  pendingInvoice: false,
  inactive: false,
  ...overrides,
});

test("рабочие дни: выходные и праздники не в счёт", () => {
  assert.equal(isWorkday(msk("2026-11-09 10:00")), true); // понедельник
  assert.equal(isWorkday(msk("2026-11-14 10:00")), false); // суббота
  assert.equal(isWorkday(msk("2026-11-04 10:00")), false); // День народного единства
  // Пробный до среды 18.11 00:00: в пятницу 13-го остаётся пт, пн, вт = 3.
  assert.equal(workdaysLeft(msk("2026-11-13 06:15"), msk("2026-11-18 00:00")), 3);
  assert.equal(workdaysLeft(msk("2026-11-12 06:15"), msk("2026-11-18 00:00")), 4);
  assert.equal(workdaysLeft(msk("2026-11-18 06:15"), msk("2026-11-18 00:00")), 0);
  // Срок задачи в субботу — понедельник 18:00.
  assert.equal(dueTodayOrNextWorkday(msk("2026-11-14 06:15")).toISOString(), msk("2026-11-16 18:00").toISOString());
  assert.equal(mskDateKey(msk("2026-11-14 01:00")), "2026-11-14");
});

test("пробный: первое касание за 4 рабочих дня, второе — за 2, выходные учтены", () => {
  // Конец в среду: первое касание — в четверг 12-го (чт, пт, пн, вт), а не в субботу.
  assert.equal(planLifecycle(trial(), S, msk("2026-11-11 06:15")), null);
  const first = planLifecycle(trial(), S, msk("2026-11-12 06:15"));
  assert.equal(first?.stage, "trial_first");
  assert.equal(first?.email, true);
  assert.deepEqual(first?.task, { kind: "call", urgent: false, discountPercent: 10, needsApproval: false });
  assert.equal(planLifecycle(trial(), S, msk("2026-11-13 06:15"))?.stage, "trial_first");
  const second = planLifecycle(trial(), S, msk("2026-11-16 06:15"));
  assert.equal(second?.stage, "trial_second");
  assert.equal(second?.task?.urgent, true);
  assert.notEqual(first?.key, second?.key);
  assert.equal(planLifecycle(trial(), S, msk("2026-11-18 06:15")), null);
});

test("заброшенный пробный — только письма; 100+ сотрудников — скидка через согласование", () => {
  const idle = planLifecycle(trial({ seats: 1, recentEntries: 0 }), S, msk("2026-11-12 06:15"));
  assert.equal(idle?.email, true);
  assert.equal(idle?.task, null);
  const big = planLifecycle(trial({ seats: 140 }), S, msk("2026-11-12 06:15"));
  assert.deepEqual(big?.task, { kind: "call", urgent: false, discountPercent: 20, needsApproval: true });
});

test("после пробного и при просрочке оплаты — задачи, у оплаченных по счёту — счёт заранее", () => {
  const lost = planLifecycle(trial({ kind: "needs_decision", reason: "trial_ended" }), S, msk("2026-11-19 06:15"));
  assert.equal(lost?.stage, "trial_lost");
  assert.equal(lost?.task?.kind, "lost_reason");
  assert.equal(planLifecycle(trial({ kind: "needs_decision", reason: "trial_ended" }), S, msk("2026-11-25 06:15")), null);
  // Пробный кончился до запуска сценария — задач по старым аккаунтам нет.
  assert.equal(planLifecycle(trial({ kind: "needs_decision", reason: "trial_ended", trialEndsAt: msk("2026-11-07 00:00") }), S, msk("2026-11-09 06:15")), null);

  const end = msk("2026-12-01 00:00");
  const overdue = planLifecycle(trial({ kind: "needs_decision", reason: "subscription_expired", trialEndsAt: null, subscriptionEnd: end }), S, msk("2026-12-01 06:15"));
  assert.equal(overdue?.task?.kind, "payment_overdue");

  const paid = trial({ kind: "paid", trialEndsAt: null, paidUntil: end, subscriptionEnd: end, paysByInvoice: true });
  assert.equal(planLifecycle(paid, S, msk("2026-11-10 06:15")), null); // больше 10 рабочих дней
  const ahead = planLifecycle(paid, S, msk("2026-11-17 06:15"));
  assert.equal(ahead?.stage, "invoice_ahead");
  assert.equal(ahead?.invoice, true);
  assert.equal(planLifecycle({ ...paid, pendingInvoice: true }, S, msk("2026-11-17 06:15")), null);
  assert.equal(planLifecycle({ ...paid, paysByInvoice: false }, S, msk("2026-11-17 06:15")), null);
});

test("выключено, пауза, демо — ничего", () => {
  assert.equal(planLifecycle(trial(), { ...S, enabled: false }, msk("2026-11-12 06:15")), null);
  assert.equal(planLifecycle(trial({ inactive: true }), S, msk("2026-11-12 06:15")), null);
  assert.equal(planLifecycle(trial({ kind: "exempt" }), S, msk("2026-11-12 06:15")), null);
});

test("настройки: мусор отбрасывается, второе касание раньше первого", () => {
  const s = normalizeLifecycleSettings({ enabled: false, trialFirstWorkdays: 3, trialSecondWorkdays: 5, discounts: [{ minSeats: 50, percent: 25 }, { minSeats: "x" }, { minSeats: 1, percent: 5 }] });
  assert.equal(s.enabled, false);
  assert.equal(s.trialSecondWorkdays, 2);
  assert.deepEqual(s.discounts, [{ minSeats: 1, percent: 5 }, { minSeats: 50, percent: 25 }]);
  assert.deepEqual(normalizeLifecycleSettings(null), S);
  assert.equal(suggestedDiscount(30, S.discounts), 15);
  assert.equal(suggestedDiscount(0, S.discounts), 0);
});
