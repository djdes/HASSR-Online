import { mskInputToDate } from "./promotions";

/**
 * Стартовый набор промокодов (scripts/seed-promo-codes.ts создаёт их
 * ВЫКЛЮЧЕННЫМИ — включает ROOT на /root/promo-codes, когда нужен канал).
 *
 * Сроки — по Москве. «Только новым» = организации без оплаченных заказов,
 * то есть фактически «первая оплата»: этим пользуется OCTOBER20 — после
 * бесплатного периода 1–10 октября платят впервые все, кто им пользовался.
 * Все коды считаются от цены по акции, если акция идёт.
 */

export type StarterPromoCode = {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
  newClientsOnly: boolean;
  /** Назначение — уходит в заметку кода, её видно в таблице ROOT. */
  note: string;
};

function msk(value: string): Date {
  const date = mskInputToDate(value);
  if (!date) throw new Error(`bad MSK date ${value}`);
  return date;
}

/** Последняя секунда дня по Москве: «по 31.10 включительно». */
function mskEndOfDay(day: string): Date {
  return new Date(msk(`${day}T23:59`).getTime() + 59_999);
}

export const STARTER_PROMO_CODES: StarterPromoCode[] = [
  {
    code: "OCTOBER20",
    kind: "percent",
    value: 20,
    startsAt: msk("2026-10-11T00:00"),
    endsAt: mskEndOfDay("2026-10-31"),
    maxUses: 500,
    newClientsOnly: true,
    note: "Переход после бесплатного периода 1–10 октября: −20 % на первую оплату до 31.10. Для окна перехода и письма.",
  },
  {
    code: "START30",
    kind: "percent",
    value: 30,
    startsAt: null,
    endsAt: mskEndOfDay("2026-12-31"),
    maxUses: 200,
    newClientsOnly: true,
    note: "Первый месяц новым клиентам −30 % (реклама, лендинг, вебинары). Только первая оплата.",
  },
  {
    code: "PARTNER10",
    kind: "percent",
    value: 10,
    startsAt: null,
    endsAt: mskEndOfDay("2027-03-31"),
    maxUses: 300,
    newClientsOnly: false,
    note: "Партнёрам и отделу продаж: −10 % на любую оплату клиента, до 31.03.2027.",
  },
  {
    code: "SUPPORT500",
    kind: "fixed",
    value: 500,
    startsAt: null,
    endsAt: mskEndOfDay("2026-12-31"),
    maxUses: 30,
    newClientsOnly: false,
    note: "Поддержка: −500 ₽ в извинение за сбой или долгий ответ. Выдавать поштучно.",
  },
];
