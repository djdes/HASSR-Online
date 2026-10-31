import type { OrgSphere } from "@/lib/org-profile";

/**
 * Блок «Сегодня» на публичной странице бейджа (2026-10-31, «специально для
 * сфер»): у школы и детсада — родителям о питании (блюда бракеража, суточные
 * пробы, витаминизация), у кафе — гостям о кухне, у бассейна — посетителям о
 * воде, у салона — клиентам о стерилизации. Отметки берутся из журналов,
 * которые организация реально ведёт; страница обезличена — ни имён, ни
 * подписей, ни содержимого записей, кроме названия блюда и оценки.
 *
 * Модуль чистый: что показывать по сфере и как понять «есть запись за день»
 * по каждому способу хранения журнала. Работа с базой — `today-data.ts`.
 */

export type TodayFactKey = "staff" | "cold" | "cleaning" | "samples" | "vitamins" | "pool" | "sterilization";

export type TodayFactSpec = {
  key: TodayFactKey;
  /** Коды журналов: отметка есть, если заполнен хотя бы один. */
  codes: readonly string[];
  label: string;
};

/** Блюда бракеража: списком (школа, больница, столовая), числом или никак. */
export type DishMode = "list" | "count" | "none";

export type SphereToday = {
  audience: string;
  title: string;
  lead: string;
  facts: readonly TodayFactSpec[];
  dishes: DishMode;
  dishesTitle: string;
  /** Табличка для зала: заголовок и пояснение под QR. */
  signTitle: string;
  signLead: string;
};

const STAFF_CODES = ["hygiene", "health_check"] as const;

const fact = (key: TodayFactKey, codes: readonly string[], label: string): TodayFactSpec => ({ key, codes, label });

const STAFF = fact("staff", STAFF_CODES, "Персонал осмотрен перед сменой");
const STAFF_KITCHEN = fact("staff", STAFF_CODES, "Сотрудники пищеблока осмотрены перед сменой");
const STAFF_SHOP = fact("staff", STAFF_CODES, "Продавцы осмотрены перед сменой");
const COLD = fact("cold", ["cold_equipment_control"], "Температура в холодильниках проверена");
const COLD_SHOP = fact("cold", ["cold_equipment_control"], "Температура в холодильных витринах проверена");
const CLEANING = fact("cleaning", ["cleaning"], "Уборка проведена");
const CLEANING_KITCHEN = fact("cleaning", ["cleaning"], "Уборка пищеблока проведена");
const SAMPLES = fact("samples", ["daily_samples"], "Суточные пробы отобраны и хранятся 48 часов");
const VITAMINS = fact("vitamins", ["vitaminization"], "Третьи блюда витаминизированы");
const POOL = fact("pool", ["pool_water_control"], "Вода в бассейне проверена: хлор, pH, температура");
const STERILIZATION = fact("sterilization", ["instrument_sterilization"], "Инструменты простерилизованы");

const SCAN = "Наведите камеру телефона на код —";

const KITCHEN: SphereToday = {
  audience: "Гостям",
  title: "Кухня сегодня",
  lead: "Что сегодня отмечено в журналах кухни: осмотр персонала, температура холодильников, уборка и бракераж блюд.",
  facts: [STAFF, COLD, CLEANING],
  dishes: "count",
  dishesTitle: "Блюда прошли бракераж",
  signTitle: "Кухня под контролем",
  signLead: `${SCAN} увидите, что сегодня проверено на кухне.`,
};

const MEALS: SphereToday = {
  audience: "Родителям",
  title: "Питание сегодня",
  lead: "Какие блюда сегодня проверила бракеражная комиссия и что сделано на пищеблоке: суточные пробы, витаминизация, осмотр персонала.",
  facts: [STAFF_KITCHEN, SAMPLES, VITAMINS, COLD, CLEANING_KITCHEN],
  dishes: "list",
  dishesTitle: "Блюда прошли бракераж",
  signTitle: "Питание под контролем",
  signLead: `${SCAN} увидите, какие блюда сегодня проверила бракеражная комиссия и что сделано на пищеблоке.`,
};

const SPHERE_TODAY: Record<OrgSphere, SphereToday> = {
  restaurant: KITCHEN,
  cafe: KITCHEN,
  bar: KITCHEN,
  fastfood: KITCHEN,
  hotel: KITCHEN,
  gas_station: KITCHEN,
  canteen: {
    ...KITCHEN,
    lead: "Какие блюда сегодня прошли бракераж и что отмечено в журналах кухни: суточные пробы, осмотр персонала, температура, уборка.",
    facts: [STAFF, SAMPLES, COLD, CLEANING],
    dishes: "list",
  },
  catering: {
    ...KITCHEN,
    audience: "Заказчикам",
    lead: "Какие блюда сегодня прошли бракераж и что отмечено в журналах кухни: суточные пробы, осмотр персонала, температура, уборка.",
    facts: [STAFF, SAMPLES, COLD, CLEANING],
    dishes: "list",
  },
  bakery: {
    ...KITCHEN,
    audience: "Покупателям",
    title: "Пекарня сегодня",
    lead: "Что сегодня отмечено в журналах пекарни: осмотр персонала, температура холодильников, уборка и бракераж изделий.",
    dishesTitle: "Изделия прошли бракераж",
    signTitle: "Выпечка под контролем",
    signLead: `${SCAN} увидите, что сегодня проверено в пекарне.`,
  },
  education: MEALS,
  medical: {
    ...MEALS,
    audience: "Пациентам и родственникам",
    lead: "Какие блюда сегодня проверила бракеражная комиссия и что сделано на пищеблоке: суточные пробы, витаминизация, осмотр персонала.",
  },
  retail: {
    audience: "Покупателям",
    title: "Магазин сегодня",
    lead: "Что сегодня отмечено в журналах магазина: осмотр продавцов, температура холодильных витрин и уборка.",
    facts: [STAFF_SHOP, COLD_SHOP, CLEANING],
    dishes: "none",
    dishesTitle: "",
    signTitle: "Продукты под контролем",
    signLead: `${SCAN} увидите, что сегодня проверено в магазине.`,
  },
  production: {
    ...KITCHEN,
    audience: "Покупателям и партнёрам",
    title: "Производство сегодня",
    lead: "Что сегодня отмечено в журналах производства: осмотр персонала, температура холодильников, уборка и бракераж продукции.",
    dishesTitle: "Продукция прошла бракераж",
    signTitle: "Производство под контролем",
    signLead: `${SCAN} увидите, что сегодня проверено на производстве.`,
  },
  fitness: {
    audience: "Посетителям",
    title: "Клуб сегодня",
    lead: "Что сегодня отмечено в журналах клуба: контроль воды в бассейне и уборка.",
    facts: [POOL, CLEANING],
    dishes: "none",
    dishesTitle: "",
    signTitle: "Чистота под контролем",
    signLead: `${SCAN} увидите, что сегодня проверено в клубе.`,
  },
  beauty: {
    audience: "Клиентам",
    title: "Салон сегодня",
    lead: "Что сегодня отмечено в журналах салона: стерилизация инструментов и уборка.",
    facts: [STERILIZATION, CLEANING],
    dishes: "none",
    dishesTitle: "",
    signTitle: "Стерильность под контролем",
    signLead: `${SCAN} увидите, что сегодня сделано в салоне.`,
  },
  other: {
    ...KITCHEN,
    audience: "Посетителям",
    title: "Сегодня",
    lead: "Что сегодня отмечено в журналах: осмотр персонала, температура холодильников и уборка.",
    signTitle: "Под контролем",
    signLead: `${SCAN} увидите, что сегодня отмечено в журналах.`,
  },
};

export function sphereToday(sphere: OrgSphere): SphereToday {
  return SPHERE_TODAY[sphere] ?? SPHERE_TODAY.other;
}

/** Коды журналов, которые нужны блоку сферы (отметки и бракераж). */
export function todayJournalCodes(spec: SphereToday): string[] {
  const codes = new Set<string>(spec.facts.flatMap((item) => item.codes));
  if (spec.dishes !== "none") codes.add(BRAKERAGE_CODE);
  return [...codes];
}

export const BRAKERAGE_CODE = "finished_product";

/**
 * Как журнал хранит записи: строками `JournalDocumentEntry` по дням,
 * отметками в `config.matrix` (уборка), строками бракеража в `config.rows`
 * или строками журнала-реестра в `config.rows[].values` с полем даты.
 */
export type TodayStorage = { kind: "entries" } | { kind: "cleaning" } | { kind: "brakerage" } | { kind: "register"; dateKey: string };

export const TODAY_STORAGE: Record<string, TodayStorage> = {
  hygiene: { kind: "entries" },
  health_check: { kind: "entries" },
  cold_equipment_control: { kind: "entries" },
  cleaning: { kind: "cleaning" },
  finished_product: { kind: "brakerage" },
  daily_samples: { kind: "register", dateKey: "date" },
  vitaminization: { kind: "register", dateKey: "date" },
  pool_water_control: { kind: "register", dateKey: "date" },
  instrument_sterilization: { kind: "register", dateKey: "date" },
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function rowsOf(config: unknown): Record<string, unknown>[] {
  const rows = record(config)?.rows;
  return Array.isArray(rows) ? rows.map(record).filter((row): row is Record<string, unknown> => row !== null) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Уборка: хоть одно помещение отмечено в этот день. */
export function cleaningMarkedOn(config: unknown, dayKey: string): boolean {
  const matrix = record(record(config)?.matrix);
  if (!matrix) return false;
  return Object.values(matrix).some((byDay) => {
    const cell = record(byDay)?.[dayKey];
    return cell !== undefined && cell !== null && cell !== "";
  });
}

/** Реестр: строка с датой дня в поле `dateKey`. */
export function registerFilledOn(config: unknown, dateKey: string, dayKey: string): boolean {
  return rowsOf(config).some((row) => text(record(row.values)?.[dateKey]).slice(0, 10) === dayKey);
}

export type TodayDish = {
  name: string;
  /** Выход порции: «150», «200/10». */
  weight: string | null;
  /** Время бракеража «ЧЧ:ММ». */
  time: string | null;
  /** Органолептическая оценка: «Отлично», «Доброкачественно». */
  rating: string | null;
  allowed: boolean;
};

function hhmm(value: string): string | null {
  const match = /(\d{1,2}):(\d{2})/.exec(value);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
}

/**
 * Строки бракеража за день: только то, что можно показать посторонним, —
 * блюдо, выход, время, оценка, допуск. Ни проверяющего, ни подписей.
 */
export function brakerageDishesOn(config: unknown, dayKey: string): TodayDish[] {
  return rowsOf(config)
    .filter((row) => text(row.productionDateTime).slice(0, 10) === dayKey && text(row.productName) !== "")
    .map((row) => ({
      name: text(row.productName),
      weight: text(row.portionWeight) || null,
      time: hhmm(text(row.rejectionTime)) ?? hhmm(text(row.productionDateTime).slice(10)),
      rating: text(row.organolepticResult) || text(row.organoleptic) || text(row.organolepticValue) || null,
      allowed: row.releaseAllowed !== "no",
    }));
}

/** Сегодняшний и вчерашний ключи дня «YYYY-MM-DD» для зоны организации. */
export function todayAndYesterdayKeys(todayKey: string): { today: string; yesterday: string } {
  const day = new Date(`${todayKey}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return { today: todayKey, yesterday: day.toISOString().slice(0, 10) };
}

export type TodayFactView = { key: TodayFactKey; label: string; today: boolean; yesterday: boolean };

export type TodayView = {
  sphere: SphereToday;
  facts: TodayFactView[];
  dishes: TodayDish[];
  dishMode: DishMode;
  /** Ведёт ли организация журнал бракеража (иначе блок блюд не показываем). */
  keepsBrakerage: boolean;
};

/**
 * Итог блока: отметки только по журналам, которые ведутся (есть действующий
 * документ), — иначе страница ругала бы организацию за журнал, который ей не
 * нужен. Блюда сортируются по времени бракеража.
 */
export function buildTodayView(
  spec: SphereToday,
  input: { kept: ReadonlySet<string>; filledToday: ReadonlySet<string>; filledYesterday: ReadonlySet<string>; dishes: TodayDish[] },
): TodayView {
  const facts = spec.facts
    .filter((item) => item.codes.some((code) => input.kept.has(code)))
    .map((item) => ({
      key: item.key,
      label: item.label,
      today: item.codes.some((code) => input.filledToday.has(code)),
      yesterday: item.codes.some((code) => input.filledYesterday.has(code)),
    }));
  const dishes = [...input.dishes].sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
  return {
    sphere: spec,
    facts,
    dishes: spec.dishes === "none" ? [] : dishes,
    dishMode: spec.dishes,
    keepsBrakerage: spec.dishes !== "none" && input.kept.has(BRAKERAGE_CODE),
  };
}
