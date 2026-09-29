/**
 * Промокоды — чистые правила: нормализация, проверка, расчёт скидки.
 * Скидка считается только от цены подписки: оборудование продаётся по
 * себестоимости и промокодами не дисконтируется.
 */
export type PromoRule = {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
  newClientsOnly: boolean;
  /** Скидка навсегда: первая оплата привязывает её к аккаунту. */
  lifetime?: boolean;
  /** Персональный код: только для этой почты и/или организации. */
  personalEmail?: string | null;
  organizationId?: string | null;
};

export type PromoRejectReason =
  | "not-found"
  | "inactive"
  | "not-started"
  | "expired"
  | "personal-foreign"
  | "exhausted"
  | "new-clients-only";

export const PROMO_REJECT_MESSAGES: Record<PromoRejectReason, string> = {
  "not-found": "Такого промокода нет",
  inactive: "Промокод отключён",
  "not-started": "Промокод ещё не начал действовать",
  expired: "Срок действия промокода истёк",
  "personal-foreign": "Этот промокод персональный — он выдан другой организации",
  exhausted: "Промокод уже использован максимальное число раз",
  "new-clients-only": "Этот промокод только для новых клиентов",
};

/**
 * Кто платит — для персональных кодов. Собирает сервер
 * (lib/promo/checkout.ts), браузеру не доверяем:
 *   - emails — почта заказа и почта владельца аккаунта, который продлит
 *     заказ (в нижнем регистре);
 *   - organizationIds — организация, которую продлит заказ, и остальные
 *     организации её аккаунта (сеть платит одним аккаунтом).
 */
export type PromoPayer = {
  emails: readonly string[];
  organizationIds: readonly string[];
};

/** Код выдан конкретной почте или организации. */
export function isPersonalPromo(rule: Pick<PromoRule, "personalEmail" | "organizationId">): boolean {
  return Boolean(rule.personalEmail?.trim() || rule.organizationId?.trim());
}

/**
 * Персональный код подходит плательщику: совпала почта ИЛИ организация
 * («код только для этого адреса или организации»). Не персональный код
 * подходит всем.
 */
export function personalCodeMatches(
  rule: Pick<PromoRule, "personalEmail" | "organizationId">,
  payer: PromoPayer
): boolean {
  const email = rule.personalEmail?.trim().toLowerCase() || null;
  const organizationId = rule.organizationId?.trim() || null;
  if (!email && !organizationId) return true;
  if (email && payer.emails.some((candidate) => candidate.trim().toLowerCase() === email)) return true;
  if (organizationId && payer.organizationIds.includes(organizationId)) return true;
  return false;
}

/** Код хранится и сравнивается в верхнем регистре без пробелов. */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidPromoCodeFormat(code: string): boolean {
  return /^[A-Z0-9_-]{3,32}$/.test(code);
}

/**
 * `payer` — кто платит. null/не передан — плательщик ещё неизвестен
 * (аноним без почты на проверке кода): персональный код тогда не
 * отклоняется здесь, окончательно его проверит создание заказа, где почта
 * есть всегда. Чужому персональному коду «исчерпан» не показываем —
 * причина «выдан другой организации» точнее.
 */
export function validatePromo(
  rule: PromoRule | null,
  context: { now: Date; paidUses: number; organizationHasPaidOrders: boolean; payer?: PromoPayer | null }
): { ok: true } | { ok: false; reason: PromoRejectReason; message: string } {
  const reject = (reason: PromoRejectReason) => ({ ok: false as const, reason, message: PROMO_REJECT_MESSAGES[reason] });
  if (!rule) return reject("not-found");
  if (!rule.active) return reject("inactive");
  if (rule.startsAt && context.now < rule.startsAt) return reject("not-started");
  if (rule.endsAt && context.now > rule.endsAt) return reject("expired");
  if (context.payer && !personalCodeMatches(rule, context.payer)) return reject("personal-foreign");
  if (rule.maxUses != null && context.paidUses >= rule.maxUses) return reject("exhausted");
  if (rule.newClientsOnly && context.organizationHasPaidOrders) return reject("new-clients-only");
  return { ok: true };
}

/** Скидка в рублях от цены подписки; не больше самой цены, целые рубли. */
export function computeDiscountRub(rule: Pick<PromoRule, "kind" | "value">, subscriptionRub: number): number {
  const base = Math.max(0, Math.round(subscriptionRub));
  if (base === 0) return 0;
  if (rule.kind === "percent") {
    const percent = Math.min(100, Math.max(0, rule.value));
    return Math.min(base, Math.round((base * percent) / 100));
  }
  return Math.min(base, Math.max(0, Math.round(rule.value)));
}

export function describeDiscount(rule: Pick<PromoRule, "kind" | "value">): string {
  return rule.kind === "percent" ? `−${rule.value} %` : `−${rule.value.toLocaleString("ru-RU")} ₽`;
}
