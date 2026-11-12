/**
 * Тариф в договоре клиента: Приложение № 1 «Стоимость услуг» (согласованный
 * тариф, точки, скидка) и Приложение № 2 «Перечень и цены тарифов».
 *
 * Арифметика — та же, что на оплате (`tariff-plans.ts`): цена периода за N
 * точек со скидкой по шкале точек, сверху — скидка менеджера из карточки.
 * Модуль чистый: его зовут шаблон договора, карточка ROOT и тесты.
 */

import { amountInWords } from "@/lib/closing-documents/build";
import {
  CYCLE_MONTHS,
  DEFAULT_PLAN_RATES,
  normalizePoints,
  planPeriodFullRub,
  planPeriodPriceRub,
  yearlySavingsPercent,
} from "@/lib/tariff-plans";

import type { ContractCycle, ContractPricing, ContractTier } from "./types";

export const CONTRACT_TIERS: readonly ContractTier[] = ["standard", "premium", "vip"];
export const CONTRACT_CYCLES: readonly ContractCycle[] = ["month", "year"];

export const TIER_TITLES: Record<ContractTier, string> = { standard: "Стандарт", premium: "Премиум", vip: "ВИП" };
export const CYCLE_TITLES: Record<ContractCycle, string> = { month: "1 месяц", year: "12 месяцев" };

/** По умолчанию в договоре — «Премиум» на 1 месяц, одна точка, без скидки (владелец, 2026-11-12). */
export function defaultContractPricing(rates: ContractPricing["rates"] = DEFAULT_PLAN_RATES, points = 1): ContractPricing {
  return { tier: "premium", cycle: "month", points: normalizePoints(points), discountPercent: 0, rates: cloneRates(rates) };
}

function cloneRates(rates: ContractPricing["rates"]): ContractPricing["rates"] {
  return {
    standard: { ...rates.standard },
    premium: { ...rates.premium },
    vip: { ...rates.vip },
  };
}

export function clampDiscount(value: unknown): number {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

export type ContractPricingLine = {
  /** «Доступ к сервису WeSetup, тариф «Премиум» на 1 месяц». */
  name: string;
  /** Цена периода за одну точку без скидок. */
  unitRub: number;
  points: number;
  /** Цена без скидок: период × точки. */
  fullRub: number;
  /** Итоговая скидка (точки + менеджер), % — округлённая для таблицы. */
  discountPercent: number;
  discountRub: number;
  totalRub: number;
  months: number;
};

export function contractPricingLine(pricing: ContractPricing): ContractPricingLine {
  const points = normalizePoints(pricing.points);
  const fullRub = planPeriodFullRub(pricing.rates, pricing.tier, pricing.cycle, points);
  const scaled = planPeriodPriceRub(pricing.rates, pricing.tier, pricing.cycle, points);
  const totalRub = Math.round((scaled * (100 - clampDiscount(pricing.discountPercent))) / 100);
  const discountRub = Math.max(0, fullRub - totalRub);
  return {
    name: `Доступ к сервису электронных журналов WeSetup и его обслуживание, тариф «${TIER_TITLES[pricing.tier]}» на ${CYCLE_TITLES[pricing.cycle]}`,
    unitRub: planPeriodFullRub(pricing.rates, pricing.tier, pricing.cycle, 1),
    points,
    fullRub,
    discountPercent: fullRub > 0 ? Math.round((discountRub / fullRub) * 1000) / 10 : 0,
    discountRub,
    totalRub,
    months: CYCLE_MONTHS[pricing.cycle],
  };
}

const NBSP = " ";

/** «10 800» — с неразрывными пробелами. */
export function formatAmount(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value)).replace(/\s/g, NBSP);
}

/** «4,5» → «4,5 %», без хвоста «,0». */
export function formatPercent(value: number): string {
  return `${String(Math.round(value * 10) / 10).replace(".", ",")}${NBSP}%`;
}

/** «10 800 (Десять тысяч восемьсот рублей 00 копеек), НДС не облагается». */
export function totalInWords(totalRub: number): string {
  const words = amountInWords(totalRub);
  return `${formatAmount(totalRub)}${NBSP}руб. (${words.charAt(0).toUpperCase()}${words.slice(1)}), НДС не облагается`;
}

export type PriceListRow = { name: string; discountPercent: number; priceRub: number };

/** Прайс Приложения № 2: каждый тариф помесячно и за год, цена за одну точку. */
export function contractPriceList(rates: ContractPricing["rates"]): Array<{ tier: ContractTier; rows: PriceListRow[] }> {
  return CONTRACT_TIERS.map((tier) => ({
    tier,
    rows: [
      { name: `Тариф «${TIER_TITLES[tier]}» на 1 месяц`, discountPercent: 0, priceRub: planPeriodFullRub(rates, tier, "month", 1) },
      { name: `Тариф «${TIER_TITLES[tier]}» на 12 месяцев`, discountPercent: yearlySavingsPercent(rates, tier), priceRub: planPeriodFullRub(rates, tier, "year", 1) },
    ],
  }));
}
