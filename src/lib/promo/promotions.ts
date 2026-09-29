import { computeDiscountRub, type PromoRule } from "./rules";

/**
 * Акции на подписку — чистые правила, без `db`: модуль импортируют и
 * сервер (сумма заказа), и клиентские компоненты (зачёркнутая цена,
 * калькуляторы), как `quoteSubscription`.
 *
 * Модель:
 *   - акция — процент 1–90 в окне [startsAt, endsAt): начало включительно,
 *     конец нет — ровно в endsAt акции уже нет;
 *   - окна могут пересекаться — действует наибольший процент (при равных —
 *     та, что кончается позже: для клиента скидка длится до её конца);
 *   - скидка акции — на всю сумму подписки (база + доплата за сотрудников
 *     сверх лимита), не на оборудование;
 *   - промокод считается уже от цены с акцией (`computeDiscountRub`).
 *
 * Время ROOT вводит и видит по Москве. Москва живёт в UTC+3 без перевода
 * часов (с 2014 г.), поэтому переводим фиксированным сдвигом, без Intl:
 * одинаково на сервере и в браузере — без расхождений при гидратации.
 */

export const PROMOTION_MIN_PERCENT = 1;
export const PROMOTION_MAX_PERCENT = 90;
export const PROMOTION_TITLE_MAX = 120;
export const PROMOTION_NOTE_MAX = 500;

/** Строка акции, как её читает сервер (поля модели `PricePromotion`). */
export type PromotionWindow = {
  id: string;
  title: string;
  percent: number;
  startsAt: Date;
  endsAt: Date;
  active: boolean;
};

/**
 * Действующая акция в виде, который можно отдать клиенту пропсом
 * (даты — ISO-строки: RSC не сериализует Date в клиентские компоненты).
 */
export type AppliedPromotion = {
  id: string;
  title: string;
  percent: number;
  startsAt: string;
  endsAt: string;
};

/** Цена с учётом акции — вход компонента `PromoPrice`. */
export type PriceWithPromotion = {
  /** Цена без акции, ₽. */
  baseRub: number;
  /** Цена с акцией, целые рубли; без акции = baseRub. */
  priceRub: number;
  /** baseRub − priceRub. */
  discountRub: number;
  /** Действующая акция или null (нет акции / нечего уценивать). */
  promotion: AppliedPromotion | null;
};

/** Цена тарифа сейчас — результат `getSubscriptionOffer` (lib/promo/offer.ts). */
export type SubscriptionOffer = PriceWithPromotion & {
  tariffKey: string;
  tariffTitle: string;
  /** На сколько дней продлевает оплата. */
  periodDays: number;
  /** Конец действующей акции (ISO) или null. */
  promotionEndsAt: string | null;
};

export type PromotionPhase = "scheduled" | "running" | "finished";

/** Где акция по времени (без учёта «выключена»). */
export function promotionPhase(rule: Pick<PromotionWindow, "startsAt" | "endsAt">, now: Date): PromotionPhase {
  const t = now.getTime();
  if (t < rule.startsAt.getTime()) return "scheduled";
  if (t >= rule.endsAt.getTime()) return "finished";
  return "running";
}

/** Включена и окно идёт. */
export function isPromotionEffective(rule: PromotionWindow, now: Date): boolean {
  return rule.active && promotionPhase(rule, now) === "running";
}

/**
 * Какая акция действует в `now`: наибольший процент, при равных — та,
 * что кончается позже, дальше — по id (детерминированно).
 */
export function pickActivePromotion<T extends PromotionWindow>(rules: readonly T[], now: Date): T | null {
  let best: T | null = null;
  for (const rule of rules) {
    if (!isPromotionEffective(rule, now)) continue;
    if (
      !best ||
      rule.percent > best.percent ||
      (rule.percent === best.percent &&
        (rule.endsAt.getTime() > best.endsAt.getTime() ||
          (rule.endsAt.getTime() === best.endsAt.getTime() && rule.id < best.id)))
    ) {
      best = rule;
    }
  }
  return best;
}

export function toAppliedPromotion(rule: PromotionWindow): AppliedPromotion {
  return {
    id: rule.id,
    title: rule.title,
    percent: rule.percent,
    startsAt: rule.startsAt.toISOString(),
    endsAt: rule.endsAt.toISOString(),
  };
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(PROMOTION_MAX_PERCENT, Math.max(0, Math.round(percent)));
}

/**
 * Цена с акцией. Скидка округляется до рубля так же, как процентный
 * промокод (`computeDiscountRub`): цена = база − round(база × % / 100).
 * Подходит для любой суммы подписки — базы тарифа или базы с доплатой
 * за сотрудников сверх лимита.
 */
export function applyPromotion(baseRub: number, promotion: AppliedPromotion | null): PriceWithPromotion {
  const base = Number.isFinite(baseRub) ? Math.max(0, Math.round(baseRub)) : 0;
  const percent = promotion ? clampPercent(promotion.percent) : 0;
  if (!promotion || base === 0 || percent === 0) {
    return { baseRub: base, priceRub: base, discountRub: 0, promotion: null };
  }
  const discountRub = Math.min(base, Math.round((base * percent) / 100));
  return { baseRub: base, priceRub: base - discountRub, discountRub, promotion };
}

export type CheckoutAmounts = {
  /** Цена подписки по тарифу. */
  baseRub: number;
  promotionDiscountRub: number;
  /** Цена подписки с акцией. */
  offerRub: number;
  /** Скидка промокода от цены с акцией. */
  promoDiscountRub: number;
  /** Подписка к оплате: offerRub − promoDiscountRub, не меньше нуля. */
  subscriptionRub: number;
  /** Оборудование — по прайсу, без скидок. */
  hardwareRub: number;
  /** Весь заказ до баллов: подписка + оборудование. */
  grossRub: number;
};

/**
 * Сумма заказа: акция → промокод от цены с акцией → оборудование. Одна
 * функция на создание заказа (сервер) и предпросмотр на /order.
 */
export function computeCheckoutAmounts(input: {
  baseRub: number;
  promotion: AppliedPromotion | null;
  promo: Pick<PromoRule, "kind" | "value"> | null;
  hardwareRub?: number;
}): CheckoutAmounts {
  const offer = applyPromotion(input.baseRub, input.promotion);
  const promoDiscountRub = input.promo ? computeDiscountRub(input.promo, offer.priceRub) : 0;
  const subscriptionRub = Math.max(0, offer.priceRub - promoDiscountRub);
  const hardwareRub = Math.max(0, Math.round(input.hardwareRub ?? 0));
  return {
    baseRub: offer.baseRub,
    promotionDiscountRub: offer.discountRub,
    offerRub: offer.priceRub,
    promoDiscountRub,
    subscriptionRub,
    hardwareRub,
    grossRub: subscriptionRub + hardwareRub,
  };
}

/* ------------------------------------------------------------------ время */

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
const NBSP = "\u00a0";

const pad = (n: number) => String(n).padStart(2, "0");

/** Поля московского времени момента `date`. */
function mskParts(date: Date) {
  const shifted = new Date(date.getTime() + MSK_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

/** «2026-10-01T00:00» (как `<input type="datetime-local">`) по Москве → момент. */
export function mskInputToDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hours, minutes] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hours, minutes) - MSK_OFFSET_MS;
  const date = new Date(utc);
  // 30 февраля Date.UTC молча превращает в 2 марта — такое не принимаем.
  const back = mskParts(date);
  if (back.year !== year || back.month !== month - 1 || back.day !== day) return null;
  return date;
}

/** Момент → «2026-10-01T00:00» по Москве (значение для datetime-local). */
export function dateToMskInput(date: Date): string {
  const p = mskParts(date);
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}T${pad(p.hours)}:${pad(p.minutes)}`;
}

/** «10.10.2026, 23:59» — по Москве. */
export function formatMskDateTime(date: Date): string {
  const p = mskParts(date);
  return `${pad(p.day)}.${pad(p.month + 1)}.${p.year}, ${pad(p.hours)}:${pad(p.minutes)}`;
}

/**
 * «до 10 октября» / «до 10 октября, 18:00». Акция, которая кончается в
 * полночь, действует весь предыдущий день — его и называем; 23:59 тоже
 * читается как «весь день». Год не пишем: акции короткие, а текущий год
 * на сервере и в браузере мог бы разойтись на границе суток.
 */
export function promotionEndLabel(endsAt: Date | string): string {
  const end = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  const p = mskParts(end);
  if (p.hours === 0 && p.minutes === 0) {
    const last = mskParts(new Date(end.getTime() - 60_000));
    return `до ${last.day}${NBSP}${MONTHS_GENITIVE[last.month]}`;
  }
  const day = `до ${p.day}${NBSP}${MONTHS_GENITIVE[p.month]}`;
  if (p.hours === 23 && p.minutes === 59) return day;
  return `${day}, ${pad(p.hours)}:${pad(p.minutes)}`;
}

/** Текст плашки: «−20 % до 10 октября». */
export function promotionBadgeLabel(promotion: Pick<AppliedPromotion, "percent" | "endsAt">): string {
  return `−${promotion.percent}${NBSP}% ${promotionEndLabel(promotion.endsAt)}`;
}

/**
 * Точный конец для подсказки, в тон плашке: конец в полночь — «до
 * 10.10.2026, 23:59» (последний день целиком), иначе — ровно время конца.
 */
export function promotionEndHint(promotion: Pick<AppliedPromotion, "endsAt">): string {
  const end = new Date(promotion.endsAt);
  const p = mskParts(end);
  const shown = p.hours === 0 && p.minutes === 0 ? new Date(end.getTime() - 60_000) : end;
  return `Акция действует до ${formatMskDateTime(shown)} по Москве`;
}

/**
 * Пояснение к заказу — в описание (оно же в чеке и УПД): «акция «Осень»
 * −20 %; промокод START10: −159 ₽». Пусто, если скидок нет.
 */
export function orderDiscountNote(input: {
  promotion: Pick<AppliedPromotion, "title" | "percent"> | null;
  promotionDiscountRub: number;
  promoCode: string | null;
  promoDiscountRub: number;
  /**
   * Скидка по коду — навсегда: `auto` — применилась сама (привязана к
   * аккаунту), `code` — введён lifetime-код (привяжется после оплаты).
   */
  lifetime?: "auto" | "code" | null;
}): string {
  const parts: string[] = [];
  if (input.promotion && input.promotionDiscountRub > 0) {
    parts.push(`акция «${input.promotion.title}» −${input.promotion.percent}${NBSP}%`);
  }
  if (input.promoCode && input.promoDiscountRub > 0) {
    const rub = `−${input.promoDiscountRub.toLocaleString("ru-RU")}${NBSP}₽`;
    parts.push(
      input.lifetime === "auto"
        ? `скидка навсегда по промокоду ${input.promoCode}: ${rub}`
        : input.lifetime === "code"
          ? `промокод ${input.promoCode}, скидка навсегда: ${rub}`
          : `промокод ${input.promoCode}: ${rub}`
    );
  }
  return parts.join("; ");
}

/* -------------------------------------------------------------------- ROOT */

/** Строка списка ROOT → «Акции» (сериализуется в клиентский компонент). */
export type PromotionAdminRow = {
  id: string;
  title: string;
  percent: number;
  /** ISO. */
  startsAt: string;
  endsAt: string;
  /** «2026-10-01T00:00» по Москве — значения для полей формы. */
  startsAtMsk: string;
  endsAtMsk: string;
  active: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /** Оплаченных заказов по акции и сумма скидок по ним, ₽. */
  paidOrders: number;
  discountTotalRub: number;
};

/** Запись истории изменений акций (AuditLog). */
export type PromotionAuditEntry = {
  id: string;
  action: string;
  promotionId: string | null;
  userName: string | null;
  /** ISO. */
  at: string;
  title: string | null;
  summary: string | null;
};

type PromotionSnapshot = {
  title: string;
  percent: number;
  startsAt: Date;
  endsAt: Date;
  active: boolean;
  note: string | null;
};

/** Кратко, что поменялось: «скидка 20 → 25 %; конец 11.10.2026, 00:00 → …; выключена». */
export function describePromotionChange(before: PromotionSnapshot, after: PromotionSnapshot): string {
  const parts: string[] = [];
  if (before.title !== after.title) parts.push(`название «${before.title}» → «${after.title}»`);
  if (before.percent !== after.percent) parts.push(`скидка ${before.percent} → ${after.percent} %`);
  if (before.startsAt.getTime() !== after.startsAt.getTime()) {
    parts.push(`начало ${formatMskDateTime(before.startsAt)} → ${formatMskDateTime(after.startsAt)}`);
  }
  if (before.endsAt.getTime() !== after.endsAt.getTime()) {
    parts.push(`конец ${formatMskDateTime(before.endsAt)} → ${formatMskDateTime(after.endsAt)}`);
  }
  if (before.active !== after.active) parts.push(after.active ? "включена" : "выключена");
  if ((before.note ?? "") !== (after.note ?? "")) parts.push("заметка изменена");
  return parts.join("; ") || "без изменений";
}

/** «−20 % · 01.10.2026, 00:00 — 11.10.2026, 00:00 МСК» — для истории и логов. */
export function describePromotion(p: Pick<PromotionSnapshot, "percent" | "startsAt" | "endsAt">): string {
  return `−${p.percent} % · ${formatMskDateTime(p.startsAt)} — ${formatMskDateTime(p.endsAt)} МСК`;
}

/* ---------------------------------------------------------------- проверка */

export type PromotionInput = {
  title: string;
  percent: number;
  startsAt: Date;
  endsAt: Date;
  note?: string | null;
};

export function validatePromotionInput(
  input: PromotionInput
): { ok: true; value: PromotionInput & { note: string | null } } | { ok: false; error: string } {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Укажите название акции" };
  if (title.length > PROMOTION_TITLE_MAX) {
    return { ok: false, error: `Название — не длиннее ${PROMOTION_TITLE_MAX} символов` };
  }
  if (
    !Number.isInteger(input.percent) ||
    input.percent < PROMOTION_MIN_PERCENT ||
    input.percent > PROMOTION_MAX_PERCENT
  ) {
    return { ok: false, error: `Скидка — целое число от ${PROMOTION_MIN_PERCENT} до ${PROMOTION_MAX_PERCENT} %` };
  }
  if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.endsAt.getTime())) {
    return { ok: false, error: "Укажите начало и конец акции" };
  }
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    return { ok: false, error: "Конец акции должен быть позже начала" };
  }
  const note = input.note?.trim() || null;
  if (note && note.length > PROMOTION_NOTE_MAX) {
    return { ok: false, error: `Заметка — не длиннее ${PROMOTION_NOTE_MAX} символов` };
  }
  return { ok: true, value: { ...input, title, note } };
}
