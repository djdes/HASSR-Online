/**
 * Лимит бесплатного тарифа и авто-переход на платный.
 *
 * Почему так:
 *  - Раньше лимитов не было вообще: `PLANS.maxUsers` из `src/lib/plans.ts`
 *    никем не читался, а в `Organization.subscriptionPlan` пишутся
 *    совсем другие значения (`free|paid|paused|cancelled`). Здесь —
 *    единственное место, которое реально решает «бесплатно или нет».
 *  - До конца бесплатного периода (и пока переход на оплату выключен)
 *    создание сотрудника не блокируется: вместо 402 — тихий перевод на
 *    «платный» (`ensurePlanForHeadcount`). После — на бесплатном тарифе
 *    второго активного сотрудника добавить нельзя, см.
 *    `checkSeatsForActivation` в `src/lib/billing.server.ts`.
 */

/**
 * Сколько активных сотрудников помещается в бесплатный тариф (владелец,
 * 2026-10: «тариф 1 бесплатно и 10 за 1990»). Подписка — до
 * `SUBSCRIPTION_MAX_USERS` из `plan-catalog.ts`.
 */
export const FREE_MAX_USERS = 1;

/**
 * Тестовый режим биллинга: тарифы переключаются, но деньги не берутся.
 * Выключается явным `BILLING_TEST_MODE=0` — по умолчанию включён,
 * чтобы никакой недонастроенный энв не начал внезапно требовать оплату.
 *
 * Переходом на оплату этот флаг НЕ управляет: его включают даты
 * бесплатного периода и флаг «Переход на оплату включён» в ROOT
 * (`src/lib/billing-period.ts`). После конца периода надписи «тестовый
 * режим, оплата не списывается» не показываются — это была бы неправда.
 */
export const BILLING_TEST_MODE = process.env.BILLING_TEST_MODE !== "0";

/**
 * Значения, которые реально встречаются в `Organization.subscriptionPlan`.
 * `trial` — legacy alias: так назывался бесплатный тариф до отмены
 * тестового периода; новые организации получают `free`, старые
 * значения читаются как тот же бесплатный тариф.
 */
const PLAN_LABELS: Record<string, string> = {
  trial: "Бесплатный",
  free: "Бесплатный",
  paid: "Платный",
  paused: "Приостановлен",
  cancelled: "Отменён",
};

/** Человекочитаемое название тарифа для UI. */
export function planLabel(plan: string | null | undefined): string {
  const key = (plan ?? "free").trim();
  return PLAN_LABELS[key] ?? key;
}

/** true — организация ещё на бесплатном тарифе. */
export function isFreePlan(plan: string | null | undefined): boolean {
  const key = (plan ?? "free").trim();
  // `trial` — legacy alias бесплатного тарифа, см. PLAN_LABELS.
  return key === "free" || key === "trial";
}

/** Организация приостановлена или отменена — ни тарифа, ни перехода. */
export function isInactivePlan(plan: string | null | undefined): boolean {
  const key = (plan ?? "").trim();
  return key === "paused" || key === "cancelled";
}

/**
 * true — действующий платный тариф: платные возможности включены
 * (автоввод температуры с фото). Бесплатный, приостановленный и
 * отменённый — нет. Старые значения вроде `pro` — платные.
 */
export function isPaidPlan(plan: string | null | undefined): boolean {
  const key = (plan ?? "free").trim();
  if (!key || isFreePlan(key)) return false;
  return key !== "paused" && key !== "cancelled";
}
