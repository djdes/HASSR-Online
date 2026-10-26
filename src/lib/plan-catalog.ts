import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { pluralRu } from "@/lib/plural-ru";
import {
  FREE_MAX_JOURNALS,
  FREE_MAX_POINTS,
  POINTS_DISCOUNT_FROM,
  POINTS_DISCOUNT_PERCENT,
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

/** «до 100 сотрудников на точку, больше — по согласованию» — «Премиум». */
export const PREMIUM_SEATS_LABEL = `до ${employeesGenitiveLabel(SEATS_PER_POINT.premium)} на точку, больше — по согласованию`;

/** Скидка за точки одной фразой. */
export const POINTS_NOTE =
  `Каждая точка — как ещё один тариф; от ${POINTS_DISCOUNT_FROM} точек — скидка ${POINTS_DISCOUNT_PERCENT} % на каждую.`;

export const TIER_NAMES: Record<TierId, string> = {
  free: "Бесплатный",
  standard: "Стандарт",
  premium: "Премиум",
};

/** «Стандарт — от 1 990 ₽/мес, Премиум — от 3 990 ₽/мес» (цены при оплате за год). */
export function pricesFromLine(rates: PlanRates): string {
  const fmt = (n: number) => `${new Intl.NumberFormat("ru-RU").format(n)} ₽`;
  return `«${TIER_NAMES.standard}» — от ${fmt(planMonthlyRub(rates, "standard", "year"))}/мес, «${TIER_NAMES.premium}» — от ${fmt(planMonthlyRub(rates, "premium", "year"))}/мес`;
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
        },
      },
      {
        key: "points",
        cells: {
          free: text("pointsFree", { trialDays: TRIAL_DAYS, count: FREE_MAX_POINTS }),
          standard: text("pointsPaid", { from: POINTS_DISCOUNT_FROM, percent: POINTS_DISCOUNT_PERCENT }),
          premium: text("pointsPaid", { from: POINTS_DISCOUNT_FROM, percent: POINTS_DISCOUNT_PERCENT }),
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
        },
      },
      { key: "telegram", cells: { free: yes, standard: yes, premium: yes } },
      { key: "pdf", cells: { free: yes, standard: yes, premium: yes } },
      // Входящие ВСД и гашение из журнала приёмки — `mercury` в /mercury и API.
      { key: "mercury", feature: "mercury", cells: { free: text("trialOnly", { trialDays: TRIAL_DAYS }), standard: no, premium: yes } },
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
        },
      },
      { key: "ownDocuments", cells: { free: no, standard: yes, premium: yes } },
      { key: "typicalPackage", feature: "typicalPackage", cells: { free: text("trialOnly", { trialDays: TRIAL_DAYS }), standard: no, premium: yes } },
      // Цена — услуги «ППК индивидуально» из ROOT; подставляет таблица
      // (строкой: узбекские разряды у сервера и браузера разные).
      { key: "ppkIndividual", cells: { free: text("ppkFrom"), standard: text("ppkFrom"), premium: text("ppkFrom") } },
    ],
  },
  {
    key: "equipment",
    rows: [
      { key: "photoAutofill", feature: "photoAutofill", cells: { free: text("trialOnly", { trialDays: TRIAL_DAYS }), standard: no, premium: yes } },
      { key: "equipmentConnect", feature: "equipmentConnect", cells: { free: text("trialOnly", { trialDays: TRIAL_DAYS }), standard: no, premium: yes } },
      { key: "equipmentDelivery", feature: "equipmentDelivery", cells: { free: text("trialOnly", { trialDays: TRIAL_DAYS }), standard: no, premium: yes } },
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
    { key: "storageOrders", values: { mb: Math.round(STORAGE_BYTES.standard / MB) } },
    { key: "ownPackage" },
  ],
  premium: [
    // Первым — лимит: «больше — по согласованию» и ссылка «связаться» (витрина).
    { key: "employeesPremium", values: { count: SEATS_PER_POINT.premium } },
    { key: "storageAll", values: { gb: Math.round(STORAGE_BYTES.premium / (1024 * MB)) } },
    { key: "photoAutofill" },
    { key: "equipmentConnect" },
    { key: "equipmentDelivery" },
    { key: "mercury" },
    { key: "typicalPackage" },
  ],
};

/** Что даёт каждый платный тариф — для русских серверных текстов (письма, КП). */
export const PAID_TIER_SUMMARY: Record<PaidTier, string> = {
  standard: `${PAID_SEATS_LABEL}, все журналы, 10 МБ на приказы к журналам и свои документы`,
  premium:
    `${PREMIUM_SEATS_LABEL}, всё из «Стандарта», 1 ГБ на все документы, автоввод показаний с фото датчика, ` +
    "подключение и доставка оборудования, ФГИС «Меркурий», типовой пакет документов",
};
