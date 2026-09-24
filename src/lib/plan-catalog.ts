import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { JOURNALS_TOTAL_LABEL } from "@/lib/journal-catalog";

/**
 * Витрина тарифов — единственное место копирайта для `/settings/subscription`.
 *
 * Почему отдельно от `src/lib/plans.ts`: там лежат мёртвые starter/standard/pro,
 * которые никогда не писались в `Organization.subscriptionPlan`. Реальных
 * тарифов два — бесплатный (`free`; legacy-значение `trial` читается как
 * он же) и платный (`paid`), и витрина описывает именно их.
 */

export type CatalogPlanId = "free" | "paid";

export type CatalogPlan = {
  id: CatalogPlanId;
  /** Значения `Organization.subscriptionPlan`, которые считаются этим тарифом. */
  matches: string[];
  nameRu: string;
  /** Цена строкой: у платного она зависит от численности, числом не выразить. */
  price: string;
  priceHint: string;
  tagline: string;
  /** Кумулятивная витрина: у платного показываем «Всё из «Бесплатного»» + дельту. */
  inheritsFrom?: string;
  features: string[];
};

/**
 * Единственное условие бесплатного тарифа — численность. Тестового
 * периода и лимитов на записи/датчики/AI нет: фраза стоит под карточкой
 * бесплатного тарифа на лендинге и в кабинете.
 */
export const FREE_PLAN_NOTE =
  `Бесплатно до ${FREE_MAX_USERS} сотрудников, без ограничений по записям.`;

/** Сколько сотрудников покрывает платная подписка. */
export const SUBSCRIPTION_MAX_USERS = 30;

/** Каждый сотрудник сверх `SUBSCRIPTION_MAX_USERS` — фиксированная доплата в месяц. */
export const EXTRA_USER_PRICE_RUB = 100;

/** Одна фраза для витрины, блока тарифов и кабинета — чтобы цена не разошлась. */
export const LARGE_TEAM_NOTE =
  `Каждый сотрудник сверх ${SUBSCRIPTION_MAX_USERS} — ${EXTRA_USER_PRICE_RUB} ₽/мес.`;

export const PLAN_CATALOG: CatalogPlan[] = [
  {
    id: "free",
    matches: ["free", "trial"],
    nameRu: "Бесплатный",
    price: "0 ₽",
    priceHint: "/мес",
    tagline: "Всё нужное для маленькой кухни — без оплаты и навсегда",
    features: [
      `До ${FREE_MAX_USERS} сотрудников`,
      `Все ${JOURNALS_TOTAL_LABEL} СанПиН и ХАССП`,
      "Telegram-бот и Mini App",
      "PDF-отчёты для проверки",
      "Без ограничений по записям, датчикам и AI-сообщениям",
    ],
  },
  {
    id: "paid",
    matches: ["paid"],
    nameRu: "Подписка",
    price: "1 990 ₽",
    priceHint: "/мес",
    tagline: "Для команды до 30 человек и автоматического заполнения",
    inheritsFrom: "Бесплатного",
    features: [
      `До ${SUBSCRIPTION_MAX_USERS} сотрудников`,
      "Свои IoT-датчики и автозаполнение",
      "Приоритетная поддержка в Telegram",
    ],
  },
];

/** Какой карточке витрины соответствует текущее значение из БД. */
export function catalogPlanIdFor(plan: string | null | undefined): CatalogPlanId {
  const key = (plan ?? "free").trim();
  return PLAN_CATALOG.find((p) => p.matches.includes(key))?.id ?? "free";
}
