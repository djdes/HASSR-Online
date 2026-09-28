import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { JOURNALS_TOTAL_LABEL } from "@/lib/journal-catalog";
import { pluralRu } from "@/lib/plural-ru";

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

/** «1 сотрудник», «3 сотрудника», «10 сотрудников». */
export function employeesLabel(count: number): string {
  return `${count} ${pluralRu(count, "сотрудник", "сотрудника", "сотрудников")}`;
}

/**
 * Родительный падеж после «до», «для», «на»: «до 1 сотрудника», «для
 * 10 сотрудников». Числа в текстах тарифов — только через эти помощники:
 * раньше строки вида «до 3 сотрудников» были вшиты по всему сайту и
 * расходились с константами при каждой смене тарифа.
 */
export function employeesGenitiveLabel(count: number): string {
  return `${count} ${pluralRu(count, "сотрудника", "сотрудников", "сотрудников")}`;
}

/** Сколько мест в бесплатном тарифе: «1 сотрудник». */
export const FREE_SEATS_LABEL = employeesLabel(FREE_MAX_USERS);

/** Короткая фраза для описаний и SEO: «Бесплатно для 1 сотрудника». */
export const FREE_TIER_SHORT = `Бесплатно для ${employeesGenitiveLabel(FREE_MAX_USERS)}`;

/** «Бесплатный тариф на 1 сотрудника» — для офферов и рекламы. */
export const FREE_PLAN_TITLE = `Бесплатный тариф на ${employeesGenitiveLabel(FREE_MAX_USERS)}`;

/**
 * Единственное условие бесплатного тарифа — численность. Тестового
 * периода и лимитов на записи/датчики/AI нет: фраза стоит под карточкой
 * бесплатного тарифа на лендинге и в кабинете.
 */
export const FREE_PLAN_NOTE = `${FREE_TIER_SHORT}, без ограничений по записям.`;

/** Сколько сотрудников покрывает платная подписка. */
export const SUBSCRIPTION_MAX_USERS = 10;

/** «до 10 сотрудников» — сколько мест в подписке. */
export const SUBSCRIPTION_SEATS_LABEL = `до ${employeesGenitiveLabel(SUBSCRIPTION_MAX_USERS)}`;

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
      FREE_SEATS_LABEL,
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
    tagline: `Для команды ${SUBSCRIPTION_SEATS_LABEL} и автоматического заполнения`,
    inheritsFrom: "Бесплатного",
    features: [
      `До ${employeesGenitiveLabel(SUBSCRIPTION_MAX_USERS)}`,
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
