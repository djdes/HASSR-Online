import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_RENEW_WINDOW_HOURS,
  autoRenewDecision,
  autoRenewDedupeKey,
  autoRenewDoneText,
  autoRenewReminderLine,
  autoRenewShortText,
  bestBalance,
  pickPayer,
  type AutoRenewUnit,
} from "./auto-renew-core";

const HOUR = 60 * 60 * 1000;
/** formatPoints группирует разряды неразрывным пробелом — сравниваем как обычный. */
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");
const now = new Date("2026-11-20T09:00:00.000Z");
const unit: AutoRenewUnit = {
  accountId: "acc-1",
  plan: "standard",
  planCycle: "month",
  planPoints: 2,
  subscriptionEnd: new Date(now.getTime() + 30 * HOUR),
  exempt: false,
  inactive: false,
  scheduledPlan: null,
  autoRenew: true,
};
const paidState = { kind: "paid", graceExpired: false };

test("срок кончается в пределах 48 ч — пора продлевать тем же тарифом, периодом и точками", () => {
  const decision = autoRenewDecision(unit, paidState, now);
  assert.ok(decision.due);
  assert.deepEqual(decision.target, { tier: "standard", cycle: "month", points: 2 });
  assert.equal(decision.expired, false);
  assert.equal(decision.dedupeKey, autoRenewDedupeKey("acc-1", unit.subscriptionEnd!));
  assert.equal(decision.dedupeKey, `autorenew:acc-1:${unit.subscriptionEnd!.toISOString()}`);
});

test("окно: раньше 48 ч — рано; ровно 48 ч — пора", () => {
  const early = autoRenewDecision({ ...unit, subscriptionEnd: new Date(now.getTime() + (AUTO_RENEW_WINDOW_HOURS + 1) * HOUR) }, paidState, now);
  assert.deepEqual(early, { due: false, reason: "not-due" });
  const edge = autoRenewDecision({ ...unit, subscriptionEnd: new Date(now.getTime() + AUTO_RENEW_WINDOW_HOURS * HOUR) }, paidState, now);
  assert.equal(edge.due, true);
});

test("после конца срока — пока идёт грейс; грейс истёк — уже не продление", () => {
  const ended = { ...unit, subscriptionEnd: new Date(now.getTime() - 5 * HOUR) };
  const inGrace = autoRenewDecision(ended, { kind: "needs_decision", graceExpired: false }, now);
  assert.ok(inGrace.due);
  assert.equal(inGrace.expired, true);
  assert.deepEqual(autoRenewDecision(ended, { kind: "needs_decision", graceExpired: true }, now), { due: false, reason: "grace-over" });
  assert.deepEqual(autoRenewDecision(ended, { kind: "free", graceExpired: false }, now), { due: false, reason: "grace-over" });
});

test("не продлеваем сам: выключено, смена тарифа, прежняя подписка, бесплатный, демо, пауза, без аккаунта", () => {
  const cases: Array<[Partial<AutoRenewUnit>, string]> = [
    [{ autoRenew: false }, "off"],
    [{ scheduledPlan: { tier: "free" } }, "scheduled"],
    [{ plan: "paid" }, "legacy"],
    [{ plan: "free" }, "not-paid-plan"],
    [{ planCycle: null }, "not-paid-plan"],
    [{ exempt: true }, "exempt"],
    [{ inactive: true }, "inactive"],
    [{ accountId: null }, "no-account"],
    [{ subscriptionEnd: null }, "no-end"],
  ];
  for (const [patch, reason] of cases) {
    assert.deepEqual(autoRenewDecision({ ...unit, ...patch }, paidState, now), { due: false, reason }, reason);
  }
});

test("плательщик: основная организация, если хватает; иначе та, где хватает; суммы не складываем", () => {
  const balances = [
    { id: "main", balanceRub: 500 },
    { id: "point-2", balanceRub: 4000 },
    { id: "point-3", balanceRub: 2500 },
  ];
  assert.equal(pickPayer(balances, "main", 400), "main");
  assert.equal(pickPayer(balances, "main", 3000), "point-2");
  assert.equal(pickPayer(balances, "main", 5000), null, "500 + 4000 + 2500 не складываем");
  assert.equal(bestBalance(balances, "main"), 4000);
  assert.equal(bestBalance([], "main"), 0);
});

test("тексты: напоминание «спишем» и «не хватает», продлено, не хватило", () => {
  assert.equal(
    plain(autoRenewReminderLine({ priceRub: 3980, balanceRub: 5000, chargeDayLabel: "19 ноября" })),
    "Автопродление включено: 19 ноября спишем 3 980 ₽ с баланса (на балансе 5 000 ₽) — продлевать вручную не нужно.",
  );
  assert.equal(
    plain(autoRenewReminderLine({ priceRub: 3980, balanceRub: 1000, chargeDayLabel: "19 ноября" })),
    "Автопродление включено, но на балансе 1 000 ₽ — не хватает 2 980 ₽. Пополните баланс до 19 ноября, и подписка продлится сама.",
  );
  assert.equal(
    plain(autoRenewDoneText({ title: "Тариф «Стандарт» на месяц, 2 точки", priceRub: 3980, balanceAfterRub: 1020, paidUntilLabel: "20 декабря" })),
    "Подписка продлена до 20 декабря: Тариф «Стандарт» на месяц, 2 точки. С баланса списано 3 980 ₽, осталось 1 020 ₽.",
  );
  const short = autoRenewShortText({ orgName: "Кафе", title: "Тариф «Стандарт»", priceRub: 1990, balanceRub: 500, lastDayLabel: "20 ноября", expired: false });
  assert.equal(plain(short.subject), "«Кафе»: не хватает 1 490 ₽ на продление");
  assert.match(plain(short.head), /на балансе 500 ₽ — не хватает 1 490 ₽/);
  assert.match(short.action, /до 20 ноября включительно/);
  assert.match(autoRenewShortText({ orgName: "Кафе", title: "Т", priceRub: 1990, balanceRub: 0, lastDayLabel: "20 ноября", expired: true }).action, /сразу после зачисления/);
});
