import { db } from "@/lib/db";
import {
  BILLING_CYCLES,
  CYCLE_DAYS,
  DEFAULT_PLAN_RATES,
  LEGACY_TARIFF_KEYS,
  PAID_TIERS,
  parsePlanTariffKey,
  planTariffKey,
  type BillingCycle,
  type PaidTier,
  type PlanRates,
} from "@/lib/tariff-plans";

/**
 * Тарифы платформы. Цена живёт в БД (`PlatformTariff`) и правится ROOT'ом
 * в /root/tariffs — лендинг, /pricing и создание платежа читают отсюда,
 * поэтому смена цены не требует деплоя.
 *
 * Тарифы 2026-10 — четыре строки: «Стандарт» и «Премиум», помесячно и за
 * год; `priceRub` — цена за месяц (годовой списывается за 12 месяцев
 * сразу). Строки «Подписки» прежнего тарифа (`monthly`, `bundle`) остаются
 * для истории заказов, но по ним больше не продаём.
 *
 * Пустая таблица (свежая база) засевается целиком, в непустую досеваются
 * недостающие тарифы 2026-10 — правки ROOT не затираются.
 */

export type Tariff = {
  key: string;
  title: string;
  priceRub: number;
  periodDays: number;
  active: boolean;
  sort: number;
};

/** Прежняя «Подписка» — ключ заказов до 2026-10 (цена — для зачёта остатка). */
export const TARIFF_MONTHLY = "monthly";
export const TARIFF_BUNDLE = "bundle";

const PLAN_TITLES: Record<PaidTier, Record<BillingCycle, string>> = {
  standard: { month: "Стандарт — помесячно", year: "Стандарт — за год" },
  premium: { month: "Премиум — помесячно", year: "Премиум — за год" },
};

/** Тарифы 2026-10 по умолчанию. */
export const PLAN_TARIFF_DEFAULTS: Tariff[] = PAID_TIERS.flatMap((tier, tierIndex) =>
  BILLING_CYCLES.map((cycle, cycleIndex) => ({
    key: planTariffKey(tier, cycle),
    title: PLAN_TITLES[tier][cycle],
    priceRub: DEFAULT_PLAN_RATES[tier][cycle],
    periodDays: CYCLE_DAYS[cycle],
    active: true,
    sort: tierIndex * 2 + cycleIndex,
  })),
);

/** Прежние тарифы: на свежей базе — для истории, выключены. */
const LEGACY_DEFAULTS: Tariff[] = [
  { key: TARIFF_MONTHLY, title: "Подписка (прежний тариф)", priceRub: 1990, periodDays: 30, active: false, sort: 10 },
  { key: TARIFF_BUNDLE, title: "Подписка + оборудование (прежний тариф)", priceRub: 1990, periodDays: 30, active: false, sort: 11 },
];

const DEFAULT_TARIFFS: Tariff[] = [...PLAN_TARIFF_DEFAULTS, ...LEGACY_DEFAULTS];

const ORDER = [{ sort: "asc" as const }, { key: "asc" as const }];

/**
 * Все тарифы, отсортированные для вывода. Пустую таблицу засевает, в
 * непустую досевает тарифы 2026-10. `createMany({ skipDuplicates })`
 * делает вызов безопасным при гонке параллельных запросов после деплоя.
 */
export async function readTariffs(): Promise<Tariff[]> {
  const rows = await db.platformTariff.findMany({ orderBy: ORDER });
  const present = new Set(rows.map((row) => row.key));
  const missing = (rows.length === 0 ? DEFAULT_TARIFFS : PLAN_TARIFF_DEFAULTS).filter((t) => !present.has(t.key));
  if (missing.length === 0) return rows.map(toTariff);

  await db.platformTariff.createMany({ data: missing, skipDuplicates: true });
  if (rows.length > 0) {
    console.info("[billing] seeded tariffs 2026-10", { keys: missing.map((t) => t.key) });
  }
  const seeded = await db.platformTariff.findMany({ orderBy: ORDER });
  return seeded.map(toTariff);
}

/**
 * Один тариф по ключу. Возвращает null для неизвестного/выключенного —
 * вызывающий код обязан это обработать (кнопка оплаты не должна создавать
 * заказ по тарифу, который ROOT снял с продажи). Старые ключи «Подписки»
 * ведут на ближайший новый тариф: по ним больше не продаём.
 */
export async function readTariff(key: string): Promise<Tariff | null> {
  const resolved = LEGACY_TARIFF_KEYS[key] ?? key;
  const all = await readTariffs();
  return all.find((t) => t.key === resolved && t.active) ?? null;
}

/** Тариф по ключу без проверки «продаётся» — для истории заказов и документов. */
export async function readTariffAny(key: string): Promise<Tariff | null> {
  const all = await readTariffs();
  return all.find((t) => t.key === key) ?? null;
}

/**
 * Фолбэк на случай, если БД недоступна при рендере публичной страницы:
 * лендинг важнее, чем точность цены до перезагрузки.
 */
export function fallbackTariffs(): Tariff[] {
  return DEFAULT_TARIFFS.map((t) => ({ ...t }));
}

export type PlanPricing = {
  /** Цена за месяц по тарифу и периоду. */
  rates: PlanRates;
  /** Продаётся ли (ROOT может снять тариф с продажи). */
  available: Record<PaidTier, Record<BillingCycle, boolean>>;
  /** Цена прежней «Подписки» за 30 дней — для зачёта остатка. */
  legacyMonthlyRub: number;
};

/** Цены тарифов 2026-10 из уже прочитанных строк. */
export function planPricingFrom(tariffs: readonly Tariff[]): PlanPricing {
  const rates: PlanRates = {
    standard: { ...DEFAULT_PLAN_RATES.standard },
    premium: { ...DEFAULT_PLAN_RATES.premium },
  };
  const available: PlanPricing["available"] = {
    standard: { month: false, year: false },
    premium: { month: false, year: false },
  };
  for (const tariff of tariffs) {
    const plan = parsePlanTariffKey(tariff.key);
    if (!plan) continue;
    rates[plan.tier][plan.cycle] = tariff.priceRub;
    available[plan.tier][plan.cycle] = tariff.active;
  }
  const legacy = tariffs.find((t) => t.key === TARIFF_MONTHLY);
  return { rates, available, legacyMonthlyRub: legacy?.priceRub ?? 1990 };
}

/** Цены тарифов 2026-10; БД недоступна — цены по умолчанию. */
export async function readPlanPricing(): Promise<PlanPricing> {
  const tariffs = await readTariffs().catch((error) => {
    console.error("[billing] tariffs read failed — default prices", error);
    return fallbackTariffs();
  });
  return planPricingFrom(tariffs);
}

function toTariff(row: {
  key: string;
  title: string;
  priceRub: number;
  periodDays: number;
  active: boolean;
  sort: number;
}): Tariff {
  return {
    key: row.key,
    title: row.title,
    priceRub: row.priceRub,
    periodDays: row.periodDays,
    active: row.active,
    sort: row.sort,
  };
}

/** Формат цены для интерфейса: «1 990 ₽». */
export function formatRub(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value) + " ₽";
}
