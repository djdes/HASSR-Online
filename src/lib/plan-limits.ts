/**
 * Лимит бесплатного тарифа и названия тарифов.
 *
 * Тарифы 2026-10 (`src/lib/tariff-plans.ts`): 14 дней без ограничений,
 * дальше бесплатно — 1 сотрудник и 1 журнал, либо «Стандарт» / «Премиум».
 * Тихого перевода на платный без оплаты больше нет: лимиты считает
 * `computeAccountBilling` (`billing-period.ts`), места проверяет
 * `checkSeatsForActivation` в `src/lib/billing.server.ts` ДО создания
 * сотрудника.
 */

/**
 * Сколько активных сотрудников остаётся на бесплатном тарифе после
 * пробного периода (владелец, 2026-10: «оставить только 1 сотрудника и
 * только 1 журнал»). Оплаченные: «Стандарт» — 25, «Премиум» — 100 на точку (`tariff-plans.ts`).
 */
export const FREE_MAX_USERS = 1;

/**
 * Тестовый режим биллинга: тарифы переключаются, но деньги не берутся.
 * Выключается явным `BILLING_TEST_MODE=0` — по умолчанию включён,
 * чтобы никакой недонастроенный энв не начал внезапно требовать оплату.
 *
 * Переходом на оплату этот флаг НЕ управляет: лимиты включает конец
 * пробного периода аккаунта и флаг «Переход на оплату включён» в ROOT
 * (`src/lib/billing-period.ts`). Надпись «тестовый режим, оплата не
 * списывается» показывается, только пока переход выключен.
 */
export const BILLING_TEST_MODE = process.env.BILLING_TEST_MODE !== "0";

/**
 * Значения, которые реально встречаются в `Organization.subscriptionPlan`.
 * `trial` — legacy alias: так назывался бесплатный тариф до отмены
 * тестового периода; новые организации получают `free`, старые
 * значения читаются как тот же бесплатный тариф. Пробный период
 * 2026-10 в поле не пишется — он выводится из дат. `paid` — «Подписка»
 * прежнего тарифа (до 2026-10), работает до конца оплаченного срока.
 */
const PLAN_LABELS: Record<string, string> = {
  trial: "Бесплатный",
  free: "Бесплатный",
  standard: "Стандарт",
  premium: "Премиум",
  paid: "Подписка (прежний тариф)",
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
 * true — в поле записан платный тариф (Стандарт, Премиум, прежняя
 * «Подписка»). Бесплатный, приостановленный и отменённый — нет. Старые
 * значения вроде `pro` — платные. Оплачен ли он сейчас и какие
 * возможности даёт — решает `computeAccountBilling`.
 */
export function isPaidPlan(plan: string | null | undefined): boolean {
  const key = (plan ?? "free").trim();
  if (!key || isFreePlan(key)) return false;
  return key !== "paused" && key !== "cancelled";
}
