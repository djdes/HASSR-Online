import type { KpPromoOption } from "@/lib/mailing/kinds/kp-shared";
import { substituteVariables, type VariableFallbacks, type VariableValues } from "@/lib/mailing/text-format";
import { computeDiscountRub, isValidPromoCodeFormat, normalizePromoCode } from "@/lib/promo/rules";
import { PROMO_VALID_DAYS_MAX, PROMO_VALID_DAYS_MIN, isValidPromoValidDays } from "@/lib/promo/valid-days";

/**
 * «Акция» — данные рассылки и проверка формы. Чистый модуль: его читают и
 * поля формы в браузере (`src/components/mailing/fields/promo.tsx`), и
 * серверный шаблон (`promo.ts`, там же — проверка кода по базе).
 */

export type PromoDesign = "aurora" | "coupon" | "countdown" | "compare" | "letter";

export type PromoMailPayload = {
  design: PromoDesign;
  subject: string;
  headline: string;
  lead: string;
  buttonText: string;
  /** Название тарифа в письме («Подписка»). */
  tariffLabel: string;
  /** Цена «было» в месяц; по умолчанию — цена платного тарифа. */
  priceRub: number;
  discountPercent: number;
  /** Срок персонального кода, дней (`valid-days.ts`). */
  durationDays: number;
  /** 3–5 строк «что входит». */
  benefits: string[];
  promo: {
    mode: "personal" | "existing";
    /** Для `existing` — код из «Промокодов», один для всех. */
    code: string | null;
    /** Для `personal`: скидка остаётся и после первой оплаты. */
    lifetime: boolean;
  };
  /** Запасные значения переменных `{имя}`, `{компания}`, `{сфера}`. */
  fallbacks: { name: string; company: string; sphere: string };
};

/** Данные для полей формы — `promoTemplate.formData()`. */
export type PromoFormData = {
  /** Действующие общие коды для «Выбрать код» (те же, что у «КП»). */
  promoOptions: KpPromoOption[];
  /** Платный тариф: подсказка для поля «Цена в месяц». */
  paidTariff: { title: string; priceRub: number } | null;
};

export const PROMO_DESIGNS: { key: PromoDesign; title: string; hint: string }[] = [
  { key: "aurora", title: "Северное сияние", hint: "Тёмная премиальная: огромная скидка и кнопка с бликом" },
  { key: "coupon", title: "Купон", hint: "Билет с промокодом и тремя шагами «как это работает»" },
  { key: "countdown", title: "Обратный отсчёт", hint: "Живой таймер до конца акции — срочность" },
  { key: "compare", title: "Было / стало", hint: "Две цены рядом и сумма экономии — для рациональных" },
  { key: "letter", title: "Личное письмо", hint: "Как от команды: по имени, без тяжёлых блоков — лучшая доставляемость" },
];

export const PROMO_DEFAULT_PERCENT = 15;
export const PROMO_DEFAULT_DAYS = 30;
export const PROMO_DEFAULT_PRICE_RUB = 1990;
export const PROMO_PERCENT_MIN = 1;
export const PROMO_PERCENT_MAX = 90;
export const PROMO_PRICE_MIN = 100;
export const PROMO_PRICE_MAX = 1_000_000;

export const PROMO_LIMITS = { subject: 150, headline: 120, lead: 600, button: 40, tariff: 60, benefit: 120, benefits: 6 } as const;

/**
 * Подстановки в текстах акции (кроме `{имя}`, `{компания}`, `{сфера}`):
 * `{percent}` — «15», `{tariff}`, `{days}` — «30 дней» (со склонением),
 * `{date}` — «21 ноября» (или «конца акции», если срока нет),
 * `{saving}` — «298», `{offer}` — «−15 % на 30 дней».
 */
export type PromoTextVars = {
  percent: number;
  tariff: string;
  /** Целое число дней — слово «дней/дня/день» подбирается само. */
  days: number;
  date: string;
  saving: number;
  offer: string;
};

const NBSP = " ";

/** «1 день», «2 дня», «30 дней». */
export function daysLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "день" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "дня" : "дней";
  return `${n}${NBSP}${word}`;
}

/** Целая сумма с неразрывным пробелом разрядов: «1 990». */
export function rubNumber(value: number): string {
  return Math.round(value).toLocaleString("ru-RU").replace(/\s/g, NBSP);
}

/** «1 990 ₽» с неразрывными пробелами. */
export function rubLabel(value: number): string {
  return `${rubNumber(value)}${NBSP}₽`;
}

/**
 * Текст формы → готовая строка: сначала величины акции, потом переменные
 * получателя (значение из CSV не превращается в величину акции).
 */
export function fillPromoText(
  text: string,
  vars: PromoTextVars,
  values: VariableValues,
  fallbacks: VariableFallbacks = {}
): string {
  const map: Record<string, string> = {
    percent: String(vars.percent),
    tariff: vars.tariff,
    days: daysLabel(vars.days),
    date: vars.date,
    saving: rubNumber(vars.saving),
    offer: vars.offer,
  };
  const withVars = text.replace(/\{(percent|tariff|days|date|saving|offer)\}/g, (m, key: string) => map[key] ?? m);
  const glued = withVars.replace(/(\d) (%|₽)/g, `$1${NBSP}$2`);
  return substituteVariables(glued, values, fallbacks);
}

/** Тексты письма по дизайну: подставляются в форму при выборе дизайна. */
export function designDefaults(design: PromoDesign): Pick<PromoMailPayload, "subject" | "headline" | "lead" | "buttonText"> {
  switch (design) {
    case "aurora":
      return {
        subject: "{компания}: скидка {percent} % на WeSetup на {days}",
        headline: "{tariff} на {percent} % дешевле",
        lead: "Электронные журналы СанПиН и ХАССП без бумаги — теперь со скидкой. Предложение действует {days}.",
        buttonText: "Забрать скидку {percent} %",
      };
    case "coupon":
      return {
        subject: "Ваш промокод на −{percent} % уже ждёт",
        headline: "Промокод на тариф «{tariff}»",
        lead: "Нажмите кнопку — код применится сам, скидка будет уже в счёте.",
        buttonText: "Применить промокод",
      };
    case "countdown":
      return {
        subject: "{days} со скидкой {percent} % — отсчёт пошёл",
        headline: "Успейте до {date}",
        lead: "Скидка {percent} % на тариф «{tariff}» действует ограниченное время. Таймер вверху письма показывает, сколько осталось.",
        buttonText: "Успеть со скидкой",
      };
    case "compare":
      return {
        subject: "{tariff} WeSetup дешевле на {saving} ₽ в месяц",
        headline: "Та же подписка — меньше платёж",
        lead: "Все журналы, сотрудники и напоминания — как прежде. Меняется только сумма.",
        buttonText: "Оплатить со скидкой",
      };
    case "letter":
      return {
        subject: "{имя}, персональная скидка для {компания}",
        headline: "{имя}, здравствуйте!",
        lead: "Мы подготовили для {компания} персональное предложение: {offer}. Скидка действует на подписку WeSetup, а код уже в ссылке — ничего вводить не нужно.",
        buttonText: "Воспользоваться предложением",
      };
  }
}

export const PROMO_DEFAULT_BENEFITS = [
  "До 10 сотрудников в одном кабинете",
  "Все журналы СанПиН и ХАССП",
  "Напоминания и задачи сотрудникам",
  "Готовый архив для проверки Роспотребнадзора",
];

export function defaultPromoPayload(design: PromoDesign = "aurora"): PromoMailPayload {
  return {
    design,
    ...designDefaults(design),
    tariffLabel: "Подписка",
    priceRub: PROMO_DEFAULT_PRICE_RUB,
    discountPercent: PROMO_DEFAULT_PERCENT,
    durationDays: PROMO_DEFAULT_DAYS,
    benefits: [...PROMO_DEFAULT_BENEFITS],
    promo: { mode: "personal", code: null, lifetime: false },
    fallbacks: { name: "коллеги", company: "ваше заведение", sphere: "общепит" },
  };
}

/** Цены: скидка округляется до рубля как у `applyPromotion` и процентного промокода. */
export function promoPrices(priceRub: number, percent: number): { oldRub: number; newRub: number; savingRub: number } {
  const oldRub = Math.max(0, Math.round(priceRub));
  const savingRub = computeDiscountRub({ kind: "percent", value: percent }, oldRub);
  return { oldRub, newRub: oldRub - savingRub, savingRub };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function num(value: unknown, fallback: number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim().replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

const DESIGN_KEYS = new Set<string>(PROMO_DESIGNS.map((d) => d.key));

export function isPromoDesign(value: unknown): value is PromoDesign {
  return typeof value === "string" && DESIGN_KEYS.has(value);
}

/** Черновик (что угодно) → форма с нужными полями; ничего не отвергает. */
export function coercePromoPayload(raw: unknown): PromoMailPayload {
  const r = record(raw);
  const design = isPromoDesign(r.design) ? r.design : "aurora";
  const base = defaultPromoPayload(design);
  const p = record(r.promo);
  const f = record(r.fallbacks);
  const mode = p.mode === "existing" || p.mode === "personal" ? p.mode : base.promo.mode;
  return {
    design,
    subject: str(r.subject, base.subject),
    headline: str(r.headline, base.headline),
    lead: str(r.lead, base.lead),
    buttonText: str(r.buttonText, base.buttonText),
    tariffLabel: str(r.tariffLabel, base.tariffLabel),
    priceRub: num(r.priceRub, base.priceRub),
    discountPercent: num(r.discountPercent, base.discountPercent),
    durationDays: num(r.durationDays, base.durationDays),
    benefits: Array.isArray(r.benefits) ? r.benefits.filter((b): b is string => typeof b === "string") : base.benefits,
    promo: {
      mode,
      code: typeof p.code === "string" && p.code.trim() ? p.code.trim().slice(0, 64) : null,
      lifetime: typeof p.lifetime === "boolean" ? p.lifetime : base.promo.lifetime,
    },
    fallbacks: {
      name: str(f.name, base.fallbacks.name),
      company: str(f.company, base.fallbacks.company),
      sphere: str(f.sphere, base.fallbacks.sphere),
    },
  };
}

/**
 * Проверка формы без базы (у `existing` код дополнительно сверяется с
 * «Промокодами» на сервере). Тексты ошибок — для ROOT.
 */
export function checkPromoPayload(raw: unknown): { ok: true; payload: PromoMailPayload } | { ok: false; error: string } {
  const payload = coercePromoPayload(raw);
  const subject = payload.subject.trim();
  const headline = payload.headline.trim();
  const lead = payload.lead.trim();
  const buttonText = payload.buttonText.trim();
  const tariffLabel = payload.tariffLabel.trim();
  if (!subject) return { ok: false, error: "Введите тему письма" };
  if (subject.length > PROMO_LIMITS.subject) return { ok: false, error: `Тема — не длиннее ${PROMO_LIMITS.subject} знаков` };
  if (!headline) return { ok: false, error: "Введите заголовок письма" };
  if (headline.length > PROMO_LIMITS.headline) return { ok: false, error: `Заголовок — не длиннее ${PROMO_LIMITS.headline} знаков` };
  if (lead.length > PROMO_LIMITS.lead) return { ok: false, error: `Текст — не длиннее ${PROMO_LIMITS.lead} знаков` };
  if (!buttonText) return { ok: false, error: "Введите текст кнопки" };
  if (buttonText.length > PROMO_LIMITS.button) return { ok: false, error: `Текст кнопки — не длиннее ${PROMO_LIMITS.button} знаков` };
  if (!tariffLabel) return { ok: false, error: "Введите название тарифа" };
  if (tariffLabel.length > PROMO_LIMITS.tariff) return { ok: false, error: `Название тарифа — не длиннее ${PROMO_LIMITS.tariff} знаков` };
  if (!Number.isInteger(payload.discountPercent) || payload.discountPercent < PROMO_PERCENT_MIN || payload.discountPercent > PROMO_PERCENT_MAX) {
    return { ok: false, error: `Скидка — целое число процентов от ${PROMO_PERCENT_MIN} до ${PROMO_PERCENT_MAX}` };
  }
  if (!isValidPromoValidDays(payload.durationDays)) {
    return { ok: false, error: `Срок — целое число дней от ${PROMO_VALID_DAYS_MIN} до ${PROMO_VALID_DAYS_MAX}` };
  }
  if (!Number.isInteger(payload.priceRub) || payload.priceRub < PROMO_PRICE_MIN || payload.priceRub > PROMO_PRICE_MAX) {
    return { ok: false, error: `Цена в месяц — целое число рублей от ${PROMO_PRICE_MIN} до ${PROMO_PRICE_MAX.toLocaleString("ru-RU")}` };
  }
  const benefits = payload.benefits.map((b) => b.trim()).filter(Boolean);
  if (benefits.length > PROMO_LIMITS.benefits) return { ok: false, error: `Выгод — не больше ${PROMO_LIMITS.benefits}` };
  if (benefits.some((b) => b.length > PROMO_LIMITS.benefit)) {
    return { ok: false, error: `Каждая выгода — не длиннее ${PROMO_LIMITS.benefit} знаков` };
  }
  let code: string | null = null;
  if (payload.promo.mode === "existing") {
    code = payload.promo.code ? normalizePromoCode(payload.promo.code) : "";
    if (!code) return { ok: false, error: "Выберите промокод из списка или другой вариант промокода" };
    if (!isValidPromoCodeFormat(code)) return { ok: false, error: `Промокод «${payload.promo.code}»: латиница, цифры, «-» и «_»` };
  }
  return {
    ok: true,
    payload: { ...payload, subject, headline, lead, buttonText, tariffLabel, benefits, promo: { ...payload.promo, code } },
  };
}
