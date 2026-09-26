/**
 * Лимит бесплатного тарифа и авто-переход на платный.
 *
 * Почему так:
 *  - Раньше лимитов не было вообще: `PLANS.maxUsers` из `src/lib/plans.ts`
 *    никем не читался, а в `Organization.subscriptionPlan` пишутся
 *    совсем другие значения (`free|paid|paused|cancelled`). Здесь —
 *    единственное место, которое реально решает «бесплатно или нет».
 *  - Блокировать создание сотрудника мы НЕ хотим: сайт в тестовом
 *    режиме, оплата не списывается, а отказ на 4-м человеке убил бы
 *    первое заполнение. Поэтому вместо 402 — тихий перевод на «платный»
 *    с честным toast'ом пользователю.
 */

/** Сколько сотрудников помещается в бесплатный тариф. */
export const FREE_MAX_USERS = 3;

/**
 * Тестовый режим биллинга: тарифы переключаются, но деньги не берутся.
 * Выключается явным `BILLING_TEST_MODE=0` — по умолчанию включён,
 * чтобы никакой недонастроенный энв не начал внезапно требовать оплату.
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
