import { FREE_MAX_USERS } from "@/lib/plan-limits";
import {
  EXTRA_USER_PRICE_RUB,
  SUBSCRIPTION_MAX_USERS,
  employeesLabel,
} from "@/lib/plan-catalog";

/**
 * Единый расчёт стоимости подписки — один на лендинг, /pricing, кабинет
 * и ROOT-метрики, чтобы цифры нигде не расходились.
 *
 * Модель:
 *   - 1–`FREE_MAX_USERS` активных сотрудников — бесплатно, 0 ₽.
 *   - до `SUBSCRIPTION_MAX_USERS` — одна подписка на всю команду
 *     (цена тарифа `monthly` из БД), НЕ за человека.
 *   - каждый сотрудник сверх `SUBSCRIPTION_MAX_USERS` —
 *     +`EXTRA_USER_PRICE_RUB` ₽/мес.
 *
 * Цена подписки живёт в `PlatformTariff` и правится ROOT'ом, поэтому
 * модуль её не читает сам: вызывающий код берёт её через `readTariff`
 * (сервер) или получает пропсом (клиент) и передаёт сюда. Так модуль
 * остаётся client-safe — без импорта `db`.
 *
 * Годового тарифа нет: `yearlyRub` — справочные ×12, не цена со скидкой.
 */

export type SubscriptionQuote = {
  employees: number;
  isFree: boolean;
  baseRub: number;
  extraEmployees: number;
  extraRub: number;
  monthlyRub: number;
  yearlyRub: number;
  tierLabel: string;
};

export function quoteSubscription(
  employees: number,
  subscriptionMonthlyRub: number
): SubscriptionQuote {
  // Слайдер и счётчики из БД могут прислать что угодно — считаем по
  // целому неотрицательному числу.
  const count = Number.isFinite(employees) ? Math.max(0, Math.floor(employees)) : 0;

  if (count <= FREE_MAX_USERS) {
    return {
      employees: count,
      isFree: true,
      baseRub: 0,
      extraEmployees: 0,
      extraRub: 0,
      monthlyRub: 0,
      yearlyRub: 0,
      tierLabel: "бесплатно",
    };
  }

  const baseRub = subscriptionMonthlyRub;
  const extraEmployees = Math.max(0, count - SUBSCRIPTION_MAX_USERS);
  const extraRub = extraEmployees * EXTRA_USER_PRICE_RUB;
  const monthlyRub = baseRub + extraRub;

  return {
    employees: count,
    isFree: false,
    baseRub,
    extraEmployees,
    extraRub,
    monthlyRub,
    yearlyRub: monthlyRub * 12,
    tierLabel:
      extraEmployees === 0
        ? "подписка"
        : `подписка + ${extraEmployees} сверх ${SUBSCRIPTION_MAX_USERS}`,
  };
}

/** Три строки шкалы для справочных списков в UI — из тех же констант. */
export function pricingScaleRows(
  subscriptionMonthlyRub: number
): { range: string; price: string }[] {
  return [
    {
      // «1 сотрудник», а не «1–1 сотрудников» (тариф 2026-10).
      range:
        FREE_MAX_USERS === 1
          ? employeesLabel(1)
          : `1–${employeesLabel(FREE_MAX_USERS)}`,
      price: "бесплатно",
    },
    {
      range: `${FREE_MAX_USERS + 1}–${SUBSCRIPTION_MAX_USERS}`,
      price: `${subscriptionMonthlyRub.toLocaleString("ru-RU")} ₽/мес за всю команду`,
    },
    {
      range: `${SUBSCRIPTION_MAX_USERS + 1} и больше`,
      price: `+${EXTRA_USER_PRICE_RUB.toLocaleString("ru-RU")} ₽/мес за каждого сверх ${SUBSCRIPTION_MAX_USERS}`,
    },
  ];
}
