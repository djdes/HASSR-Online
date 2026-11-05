import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { pluralRu } from "@/lib/plural-ru";
import {
  FREE_MAX_JOURNALS,
  FREE_MAX_POINTS,
  POINTS_DISCOUNT_STEPS,
  POINTS_INDIVIDUAL_FROM,
  SEATS_PER_POINT,
  STORAGE_BYTES,
  TRIAL_DAYS,
  isPaidTier,
  planMonthlyRub,
  type PaidTier,
  type PlanFeature,
  type PlanRates,
  type TierId,
} from "@/lib/tariff-plans";

/** Часы горячей линии «ВИП» в месяц — «продумать количество часов» (владелец); пока 10. */
export const VIP_HOTLINE_HOURS = 10;

/**
 * Копирайт тарифов 2026-10 — единственное место русских фраз про тарифы для
 * серверных текстов (SEO-описания, письма, бот, КП). Витрины на сайте и в
 * кабинете берут подписи из каталогов i18n, а числа — отсюда и из
 * `tariff-plans.ts`, поэтому смена лимита не требует правки текстов.
 */

/** «1 сотрудник», «3 сотрудника», «10 сотрудников». */
export function employeesLabel(count: number): string {
  return `${count} ${pluralRu(count, "сотрудник", "сотрудника", "сотрудников")}`;
}

/**
 * Родительный падеж после «до», «для», «на»: «до 1 сотрудника», «для
 * 25 сотрудников». Числа в текстах тарифов — только через эти помощники.
 */
export function employeesGenitiveLabel(count: number): string {
  return `${count} ${pluralRu(count, "сотрудника", "сотрудников", "сотрудников")}`;
}

/** «14 дней бесплатно» — для описаний и SEO. */
export const FREE_TIER_SHORT = `${TRIAL_DAYS} дней бесплатно`;

/** «Бесплатный тариф — 14 дней без ограничений» — для офферов и рекламы. */
export const FREE_PLAN_TITLE = `Бесплатный тариф — ${TRIAL_DAYS} дней без ограничений`;

/** Что остаётся бесплатно после пробного: «1 сотрудник и 1 журнал». */
export const FREE_AFTER_TRIAL_LABEL = `${employeesLabel(FREE_MAX_USERS)} и ${FREE_MAX_JOURNALS} журнал`;

/** Условие бесплатного тарифа одной строкой — под карточкой и в кабинете. */
export const FREE_PLAN_NOTE =
  `${TRIAL_DAYS} дней — все журналы, сотрудники и точки без ограничений, без карты. ` +
  `Дальше бесплатно — ${FREE_AFTER_TRIAL_LABEL}.`;

/** «до 25 сотрудников на точку» — «Стандарт». */
export const PAID_SEATS_LABEL = `до ${employeesGenitiveLabel(SEATS_PER_POINT.standard)} на точку`;

/** «до 40 сотрудников на точку, больше — по согласованию» — «Премиум». */
export const PREMIUM_SEATS_LABEL = `до ${employeesGenitiveLabel(SEATS_PER_POINT.premium)} на точку, больше — по согласованию`;

/** Скидка за точки одной фразой. */
/** «от 5 точек — 5 %, от 10 — 10 %, от 15 — 20 %, от 35 — 25 %, от 50 — индивидуальное предложение» */
export const POINTS_DISCOUNT_LINE =
  POINTS_DISCOUNT_STEPS.map((step, i) => `от ${step.from}${i === 0 ? " точек" : ""} — ${step.percent} %`).join(", ") +
  `, от ${POINTS_INDIVIDUAL_FROM} — индивидуальное предложение`;

export const POINTS_NOTE = `Каждая точка — как ещё один тариф; скидка на все точки: ${POINTS_DISCOUNT_LINE}.`;

export const TIER_NAMES: Record<TierId, string> = {
  free: "Бесплатный",
  standard: "Стандарт",
  premium: "Премиум",
  vip: "ВИП",
};

/** «Стандарт — от 1 990 ₽/мес, Премиум — от 3 990 ₽/мес» (цены при оплате за год). */
export function pricesFromLine(rates: PlanRates): string {
  const fmt = (n: number) => `${new Intl.NumberFormat("ru-RU").format(n)} ₽`;
  return (["standard", "premium", "vip"] as const)
    .map((tier) => `«${TIER_NAMES[tier]}» — от ${fmt(planMonthlyRub(rates, tier, "year"))}/мес`)
    .join(", ");
}

/** Какой карточке витрины соответствует значение `subscriptionPlan`. */
export function tierIdForPlan(plan: string | null | undefined): TierId | "legacy" {
  const key = String(plan ?? "free").trim();
  if (isPaidTier(key)) return key;
  if (key === "free" || key === "trial" || key === "") return "free";
  return "legacy";
}

// ------------------------------------------------- таблица сравнения

/**
 * Значение клетки: галочка, прочерк или подпись из каталога i18n
 * (`landingComponents.tariffs.cells.<key>`) с числами.
 */
export type ComparisonCell =
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "text"; key: string; values?: Record<string, number> };

export type ComparisonRow = {
  /** `landingComponents.tariffs.rows.<key>` */
  key: string;
  /** Возможность тарифа, которой соответствует строка, — для проверки тестом. */
  feature?: PlanFeature;
  cells: Record<TierId, ComparisonCell>;
};

export type ComparisonGroup = {
  /** `landingComponents.tariffs.groups.<key>` */
  key: string;
  rows: ComparisonRow[];
};

const yes: ComparisonCell = { kind: "yes" };
const no: ComparisonCell = { kind: "no" };
const text = (key: string, values?: Record<string, number>): ComparisonCell => ({ kind: "text", key, values });
const MB = 1024 * 1024;

/** Таблица под колонками — одна на лендинг, /pricing и кабинет. */
export const COMPARISON_GROUPS: readonly ComparisonGroup[] = [
  {
    key: "team",
    rows: [
      {
        key: "employees",
        cells: {
          free: text("employeesFree", { trialDays: TRIAL_DAYS, count: FREE_MAX_USERS }),
          standard: text("employeesPaid", { count: SEATS_PER_POINT.standard }),
          premium: text("employeesPremium", { count: SEATS_PER_POINT.premium }),
          vip: text("employeesPremium", { count: SEATS_PER_POINT.premium }),
        },
      },
      {
        key: "points",
        cells: {
          free: text("pointsFree", { trialDays: TRIAL_DAYS, count: FREE_MAX_POINTS }),
          standard: text("pointsPaidScale"),
          premium: text("pointsPaidScale"),
          vip: text("pointsPaidScale"),
        },
      },
    ],
  },
  {
    key: "journals",
    rows: [
      {
        key: "journals",
        cells: {
          free: text("journalsFree", { trialDays: TRIAL_DAYS, count: FREE_MAX_JOURNALS }),
          standard: text("journalsAll"),
          premium: text("journalsAll"),
          vip: text("journalsAll"),
        },
      },
      // Тарифы 2026-11-05: чек-листы — во всех тарифах, электронная ППК — с «Премиума»
      // (пока только витрина: в кабинете раздел ППК открыт всем, владелец 2026-11-05).
      { key: "checklists", cells: { free: yes, standard: yes, premium: yes, vip: yes } },
      { key: "ppkElectronic", cells: { free: text("trialOnly", { trialDays: TRIAL_DAYS }), standard: no, premium: yes, vip: yes } },
      { key: "telegram", cells: { free: yes, standard: yes, premium: yes, vip: yes } },
      { key: "pdf", cells: { free: yes, standard: yes, premium: yes, vip: yes } },
      // Входящие ВСД и гашение из журнала приёмки — `mercury` в /mercury и API.
      { key: "mercury", feature: "mercury", cells: { free: text("trialOnly", { trialDays: TRIAL_DAYS }), standard: no, premium: yes, vip: yes } },
    ],
  },
  {
    key: "documents",
    rows: [
      {
        key: "storage",
        cells: {
          free: text("storageFree", { trialDays: TRIAL_DAYS }),
          standard: text("storageStandard", { mb: Math.round(STORAGE_BYTES.standard / MB) }),
          premium: text("storagePremium", { gb: Math.round(STORAGE_BYTES.premium / (1024 * MB)) }),
          vip: text("storagePremium", { gb: Math.round(STORAGE_BYTES.premium / (1024 * MB)) }),
        },
      },
      { key: "ownDocuments", cells: { free: no, standard: yes, premium: yes, vip: yes } },
      { key: "typicalPackage", feature: "typicalPackage", cells: { free: text("trialOnly", { trialDays: TRIAL_DAYS }), standard: no, premium: yes, vip: yes } },
      // Без цены: «по запросу» открывает окно контактов (владелец, 2026-10-29).
      { key: "ppkIndividual", cells: { free: text("ppkOnRequest"), standard: text("ppkOnRequest"), premium: text("ppkOnRequest"), vip: text("ppkOnRequest") } },
      // Правки 05.11.2026: строка «План ХАССП» рядом с ППК. Что входит по тарифам,
      // в правках не сказано — как у ППК, «по запросу» (уточнить у владельца).
      { key: "haccpPlan", cells: { free: text("ppkOnRequest"), standard: text("ppkOnRequest"), premium: text("ppkOnRequest"), vip: text("ppkOnRequest") } },
    ],
  },
  {
    key: "equipment",
    rows: [
      { key: "photoAutofill", feature: "photoAutofill", cells: { free: text("trialOnly", { trialDays: TRIAL_DAYS }), standard: no, premium: yes, vip: yes } },
      { key: "equipmentConnect", feature: "equipmentConnect", cells: { free: text("trialOnly", { trialDays: TRIAL_DAYS }), standard: no, premium: yes, vip: yes } },
      { key: "equipmentDelivery", feature: "equipmentDelivery", cells: { free: text("trialOnly", { trialDays: TRIAL_DAYS }), standard: no, premium: yes, vip: yes } },
    ],
  },
  {
    // Только «ВИП»: ведёт команда вручную (владелец, 2026-11-05).
    key: "service",
    rows: [
      { key: "hotline", cells: { free: no, standard: no, premium: no, vip: text("hotlineVip", { hours: VIP_HOTLINE_HOURS }) } },
      { key: "dataBank", cells: { free: no, standard: no, premium: no, vip: yes } },
      { key: "consultant", cells: { free: no, standard: no, premium: no, vip: yes } },
    ],
  },
];

/**
 * Пункты карточек (накопительно: «Всё из «Стандарта», плюс:») — ключи
 * `landingComponents.tariffs.points.<key>` с числами.
 */
export const CARD_POINTS: Record<TierId, ReadonlyArray<{ key: string; values?: Record<string, number> }>> = {
  free: [
    { key: "trialAll", values: { trialDays: TRIAL_DAYS } },
    { key: "noCard" },
    { key: "afterTrial", values: { employees: FREE_MAX_USERS, journals: FREE_MAX_JOURNALS } },
  ],
  standard: [
    { key: "employees", values: { count: SEATS_PER_POINT.standard } },
    { key: "allJournals" },
    { key: "checklists" },
    { key: "storageOrders", values: { mb: Math.round(STORAGE_BYTES.standard / MB) } },
    { key: "ownPackage" },
  ],
  premium: [
    // Первым — лимит: «больше — по согласованию» и ссылка «связаться» (витрина).
    { key: "employeesPremium", values: { count: SEATS_PER_POINT.premium } },
    { key: "ppkElectronic" },
    { key: "storageAll", values: { gb: Math.round(STORAGE_BYTES.premium / (1024 * MB)) } },
    { key: "photoAutofill" },
    { key: "equipmentConnect" },
    { key: "equipmentDelivery" },
    { key: "mercury" },
    { key: "typicalPackage" },
  ],
  vip: [
    { key: "employeesPremium", values: { count: SEATS_PER_POINT.vip } },
    { key: "hotline", values: { hours: VIP_HOTLINE_HOURS } },
    { key: "dataBank" },
    { key: "consultant" },
  ],
};

/** Что даёт каждый платный тариф — для русских серверных текстов (письма, КП). */
export const PAID_TIER_SUMMARY: Record<PaidTier, string> = {
  standard: `${PAID_SEATS_LABEL}, все журналы, 10 МБ на приказы к журналам и свои документы`,
  premium:
    `${PREMIUM_SEATS_LABEL}, всё из «Стандарта», 1 ГБ на все документы, автоввод показаний с фото датчика, ` +
    "подключение и доставка оборудования, ФГИС «Меркурий», типовой пакет документов, электронная ППК по принципам ХАССП",
  vip:
    `${PREMIUM_SEATS_LABEL}, всё из «Премиума», горячая линия (до ${VIP_HOTLINE_HOURS} часов в месяц), ` +
    "расширенный банк данных и личный консультант",
};
