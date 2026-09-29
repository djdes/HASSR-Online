import { ORG_SPHERES, type OrgSphere } from "@/lib/org-profile";
import { isValidPromoCodeFormat, normalizePromoCode } from "@/lib/promo/rules";
import { PROMO_VALID_DAYS_MAX, PROMO_VALID_DAYS_MIN, isValidPromoValidDays } from "@/lib/promo/valid-days";

/**
 * «КП» — данные рассылки и проверка формы. Чистый модуль: его читают и
 * поля формы в браузере (`src/components/mailing/fields/kp.tsx`), и
 * серверный шаблон (`kp.ts`, там же — проверка кода по базе).
 */

export type KpPromoMode = "none" | "existing" | "personal";

export type KpPayload = {
  /** Для получателей без сферы (пользователи — по организации, контакты — по колонке «сфера»). */
  defaultSphere: OrgSphere;
  promo: {
    mode: KpPromoMode;
    /** Для `existing` — код из «Промокодов», один для всех. */
    code: string | null;
    /** Для `personal`: скидка каждого кода. */
    kind: "percent" | "fixed";
    value: number;
    /** Скидка остаётся на все будущие оплаты после первой. */
    lifetime: boolean;
    /** Срок кода в днях: до 23:59 МСК дня «сегодня + N» (`promoEndsAfterDays`). */
    validDays: number;
  };
  /** PDF вложением. По умолчанию нет: вложения повышают риск спама, в письме есть «Скачать PDF». */
  attachPdf: boolean;
};

/** Данные для полей формы — `kpTemplate.formData()`. */
export type KpFormData = {
  /** Действующие общие коды для «Выбрать код». */
  promoOptions: KpPromoOption[];
  /** Отправитель в КП по умолчанию (ROOT → «Коммерческие предложения»); null — «Команда WeSetup». */
  senderName: string | null;
};

export type KpPromoOption = {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  lifetime: boolean;
  endsAt: string | null;
  /** Сколько оплат ещё примет код; null — без ограничения. */
  usesLeft: number | null;
  newClientsOnly: boolean;
  label: string;
};

export const KP_PERCENT_MAX = 100;
export const KP_FIXED_MAX = 100_000;
export const KP_DEFAULT_VALUE = 10;
export const KP_DEFAULT_VALID_DAYS = 14;

const SPHERES = new Set<string>(ORG_SPHERES.map((s) => s.value));

export function defaultKpPayload(): KpPayload {
  return {
    defaultSphere: "restaurant",
    promo: {
      mode: "personal",
      code: null,
      kind: "percent",
      value: KP_DEFAULT_VALUE,
      lifetime: true,
      validDays: KP_DEFAULT_VALID_DAYS,
    },
    attachPdf: false,
  };
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

/** Черновик (что угодно) → форма с нужными полями; ничего не отвергает. */
export function coerceKpPayload(raw: unknown): KpPayload {
  const base = defaultKpPayload();
  const r = record(raw);
  const p = record(r.promo);
  const mode: KpPromoMode = p.mode === "none" || p.mode === "existing" || p.mode === "personal" ? p.mode : base.promo.mode;
  return {
    defaultSphere: typeof r.defaultSphere === "string" && SPHERES.has(r.defaultSphere) ? (r.defaultSphere as OrgSphere) : base.defaultSphere,
    promo: {
      mode,
      code: typeof p.code === "string" && p.code.trim() ? p.code.trim().slice(0, 64) : null,
      kind: p.kind === "fixed" ? "fixed" : p.kind === "percent" ? "percent" : base.promo.kind,
      value: num(p.value, base.promo.value),
      lifetime: typeof p.lifetime === "boolean" ? p.lifetime : base.promo.lifetime,
      validDays: num(p.validDays, base.promo.validDays),
    },
    attachPdf: r.attachPdf === true,
  };
}

/**
 * Проверка формы без базы (у `existing` код дополнительно сверяется с
 * «Промокодами» на сервере). Тексты — для ROOT.
 */
export function checkKpPayload(raw: unknown): { ok: true; payload: KpPayload } | { ok: false; error: string } {
  const payload = coerceKpPayload(raw);
  const promo = payload.promo;
  if (promo.mode === "existing") {
    const code = promo.code ? normalizePromoCode(promo.code) : "";
    if (!code) return { ok: false, error: "Выберите промокод из списка или другой вариант промокода" };
    if (!isValidPromoCodeFormat(code)) return { ok: false, error: `Промокод «${promo.code}»: латиница, цифры, «-» и «_»` };
    return { ok: true, payload: { ...payload, promo: { ...promo, code } } };
  }
  if (promo.mode === "personal") {
    if (!Number.isInteger(promo.value) || promo.value < 1) {
      return { ok: false, error: "Размер скидки — целое число больше нуля" };
    }
    if (promo.kind === "percent" && promo.value > KP_PERCENT_MAX) {
      return { ok: false, error: `Скидка в процентах — от 1 до ${KP_PERCENT_MAX}` };
    }
    if (promo.kind === "fixed" && promo.value > KP_FIXED_MAX) {
      return { ok: false, error: `Скидка в рублях — не больше ${KP_FIXED_MAX.toLocaleString("ru-RU")} ₽` };
    }
    if (!isValidPromoValidDays(promo.validDays)) {
      return { ok: false, error: `Срок кода — целое число дней от ${PROMO_VALID_DAYS_MIN} до ${PROMO_VALID_DAYS_MAX}` };
    }
  }
  // Код нужен только «Выбрать код» — в остальных режимах не храним.
  return { ok: true, payload: { ...payload, promo: { ...promo, code: null } } };
}

/** «−10 %» / «−500 ₽». */
export function kpDiscountLabel(kind: "percent" | "fixed", value: number): string {
  return kind === "percent" ? `−${value}\u00a0%` : `−${value.toLocaleString("ru-RU")}\u00a0₽`;
}
