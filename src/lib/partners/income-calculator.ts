import { percentOf, roundRub, type RewardRule } from "./rewards";

/**
 * Калькулятор дохода партнёра на /partners (2026-11-01): сколько партнёр
 * получит за первый год с N клиентов по действующей версии правил.
 *
 * Честно, как считает начисление (`computeSubscriptionAccrual`,
 * `computeBonusAccrual`): доля — с каждого платежа клиента за подписку в
 * окне правил с первой оплаты; бонус — один раз, с платежом № N. Считаем
 * только то, что приходится на первые 12 месяцев: при оплате за год бонус
 * за второй платёж — уже на второй год. Оборудование — отдельно, сюда не входит.
 */

export type CalculatorRule = Pick<
  RewardRule,
  "subscriptionPercent" | "subscriptionMonths" | "bonusAmountRub" | "bonusAfterPayments"
>;

export type CalculatorInput = {
  clients: number;
  cycle: "month" | "year";
  /** Цена одного оплачиваемого периода клиента (месяц или год) с его точками, ₽. */
  periodPriceRub: number;
};

export type CalculatorResult = {
  clients: number;
  /** Платежей одного клиента за первый год, с которых идёт доля. */
  paymentsPerClient: number;
  /** Доля с одного платежа, ₽. */
  perPaymentRub: number;
  subscriptionRub: number;
  bonusRub: number;
  totalRub: number;
  /** Бонус есть, но приходится на второй год (оплата за год). */
  bonusLater: boolean;
};

export const CALCULATOR_MAX_CLIENTS = 500;

const CYCLE_MONTHS = { month: 1, year: 12 } as const;

export function clampClients(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, CALCULATOR_MAX_CLIENTS);
}

export function partnerFirstYearIncome(rule: CalculatorRule, input: CalculatorInput): CalculatorResult {
  const clients = clampClients(input.clients);
  const step = CYCLE_MONTHS[input.cycle];
  // Платежи клиента в первые 12 месяцев: в месяцы 0, step, 2·step… < 12.
  const paymentsInYear = Math.ceil(12 / step);
  // Из них в окне правил: платёж не позже первой оплаты + N месяцев.
  let paymentsPerClient = 0;
  for (let index = 0; index < paymentsInYear; index += 1) {
    if (index * step <= rule.subscriptionMonths) paymentsPerClient += 1;
  }
  const price = Math.max(0, input.periodPriceRub);
  const perPaymentRub = percentOf(price, rule.subscriptionPercent);
  const subscriptionRub = roundRub(perPaymentRub * paymentsPerClient * clients);
  const hasBonus = rule.bonusAmountRub > 0 && rule.bonusAfterPayments >= 1;
  const bonusInYear = hasBonus && rule.bonusAfterPayments <= paymentsInYear;
  const bonusRub = bonusInYear ? roundRub(rule.bonusAmountRub * clients) : 0;
  return {
    clients,
    paymentsPerClient,
    perPaymentRub,
    subscriptionRub,
    bonusRub,
    totalRub: roundRub(subscriptionRub + bonusRub),
    bonusLater: hasBonus && !bonusInYear,
  };
}
