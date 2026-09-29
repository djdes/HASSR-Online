import {
  appliedDiscountNotice,
  pickBestDiscount,
  type AppliedDiscount,
  type LifetimeDiscountView,
} from "./discounts";
import {
  isPersonalPromo,
  isValidPromoCodeFormat,
  normalizePromoCode,
  PROMO_REJECT_MESSAGES,
  validatePromo,
  type PromoRejectReason,
  type PromoRule,
} from "./rules";

/**
 * Скидка на оплату подписки — ядро без `db` (зависимости передаются,
 * как в custom-names-save): его зовут создание заказа, счёт по безналу,
 * проверка кода и витрины через lib/promo/checkout.ts.
 *
 * Порядок как принято: акция → (промокод ИЛИ скидка навсегда — что
 * выгоднее) от цены с акцией. Сумму к оплате считает только сервер.
 */

export type PromoCodeRecord = PromoRule & {
  id: string;
  lifetime: boolean;
  personalEmail: string | null;
  organizationId: string | null;
};

/** Кого продлит заказ — так же, как решает fulfillPaidOrder. */
export type CheckoutTarget = {
  /** Организация руководителя из сессии, иначе организация пользователя с почтой заказа. */
  organizationId: string | null;
  accountId: string | null;
  /** Почта заказа и почта владельца аккаунта (нижний регистр). */
  emails: string[];
  /** Организация и остальные организации её аккаунта. */
  organizationIds: string[];
};

export type CheckoutDeps = {
  findCode(code: string): Promise<PromoCodeRecord | null>;
  /** Оплаченные заказы, где код ввели (авто-скидка навсегда не считается). */
  countCodeUses(code: string): Promise<number>;
  hasPaidOrders(input: { organizationId: string | null; email: string | null }): Promise<boolean>;
  resolveTarget(input: { organizationId: string | null; email: string | null }): Promise<CheckoutTarget>;
  /** Действующая (не отменённая) скидка навсегда аккаунта. */
  activeLifetime(accountId: string): Promise<LifetimeDiscountView | null>;
};

export type CheckoutDiscountInput = {
  /** Введённый код как есть; null/пусто — не вводили. */
  promoRaw: string | null;
  /** Организация руководителя из сессии; null — аноним или сотрудник. */
  organizationId: string | null;
  /** Почта заказа; null — ещё неизвестна (аноним на проверке кода). */
  email: string | null;
  /** Цена подписки с акцией, ₽. */
  offerRub: number;
  now: Date;
};

export type CheckoutDiscountOk = {
  ok: true;
  /** Что применится к оплате; null — скидки нет. */
  applied: AppliedDiscount | null;
  /** Действующая скидка навсегда аккаунта (даже если применился код). */
  lifetime: LifetimeDiscountView | null;
  /** Введённый код (нормализованный) или null. */
  typedCode: string | null;
  /** Пояснение, что применено и почему. */
  notice: string | null;
  /** Персональный код, а плательщик ещё неизвестен: проверим по почте при оплате. */
  personalPending: boolean;
  target: CheckoutTarget;
};

export type CheckoutDiscountRejected = {
  ok: false;
  reason: PromoRejectReason | "no-discount";
  message: string;
  typedCode: string;
  lifetime: LifetimeDiscountView | null;
  target: CheckoutTarget;
};

export type CheckoutDiscountResult = CheckoutDiscountOk | CheckoutDiscountRejected;

function lifetimeApplied(lifetime: LifetimeDiscountView, discountRub: number): AppliedDiscount {
  return {
    source: "lifetime",
    code: lifetime.code,
    kind: lifetime.kind,
    value: lifetime.value,
    lifetime: true,
    discountRub,
    lifetimeDiscountId: lifetime.id,
  };
}

export async function resolveCheckoutDiscountWith(
  deps: CheckoutDeps,
  input: CheckoutDiscountInput
): Promise<CheckoutDiscountResult> {
  const email = input.email?.trim().toLowerCase() || null;
  const typedCode = input.promoRaw?.trim() ? normalizePromoCode(input.promoRaw) : null;
  const target = await deps.resolveTarget({ organizationId: input.organizationId, email });
  const lifetime = target.accountId ? await deps.activeLifetime(target.accountId) : null;
  const reject = (reason: CheckoutDiscountRejected["reason"], message: string): CheckoutDiscountRejected => ({
    ok: false,
    reason,
    message,
    typedCode: typedCode ?? "",
    lifetime,
    target,
  });

  // Кода нет — только скидка навсегда (если есть и что-то даёт).
  if (!typedCode) {
    const best = pickBestDiscount({ offerRub: input.offerRub, code: null, lifetime });
    return {
      ok: true,
      applied: best.source === "lifetime" && lifetime ? lifetimeApplied(lifetime, best.discountRub) : null,
      lifetime,
      typedCode: null,
      notice: null,
      personalPending: false,
      target,
    };
  }
  if (!isValidPromoCodeFormat(typedCode)) return reject("not-found", PROMO_REJECT_MESSAGES["not-found"]);

  // Свой же код, уже привязанный как скидка навсегда: лимит он исчерпал
  // первой оплатой, но человеку это не ошибка — скидка и так работает.
  if (lifetime && lifetime.code === typedCode) {
    const best = pickBestDiscount({ offerRub: input.offerRub, code: null, lifetime });
    const applied = best.source === "lifetime" ? lifetimeApplied(lifetime, best.discountRub) : null;
    return {
      ok: true,
      applied,
      lifetime,
      typedCode,
      notice: appliedDiscountNotice({ applied, lifetime, typedCode }),
      personalPending: false,
      target,
    };
  }

  const row = await deps.findCode(typedCode);
  // Плательщик известен, когда есть почта заказа (создание заказа — всегда).
  const payerKnown = Boolean(email);
  const [paidUses, paidBefore] = await Promise.all([
    row ? deps.countCodeUses(row.code) : Promise.resolve(0),
    row?.newClientsOnly
      ? deps.hasPaidOrders({ organizationId: input.organizationId, email })
      : Promise.resolve(false),
  ]);
  const verdict = validatePromo(row, {
    now: input.now,
    paidUses,
    organizationHasPaidOrders: paidBefore,
    payer: payerKnown ? { emails: target.emails, organizationIds: target.organizationIds } : null,
  });
  if (!verdict.ok || !row) {
    const reason = verdict.ok ? "not-found" : verdict.reason;
    return reject(reason, verdict.ok ? PROMO_REJECT_MESSAGES["not-found"] : verdict.message);
  }

  const best = pickBestDiscount({ offerRub: input.offerRub, code: row, lifetime });
  if (best.source === null) return reject("no-discount", "Промокод не даёт скидки на этот тариф");
  const applied: AppliedDiscount =
    best.source === "lifetime" && lifetime
      ? lifetimeApplied(lifetime, best.discountRub)
      : {
          source: "code",
          code: row.code,
          kind: row.kind,
          value: row.value,
          lifetime: row.lifetime,
          discountRub: best.discountRub,
          lifetimeDiscountId: null,
        };
  return {
    ok: true,
    applied,
    lifetime,
    typedCode,
    notice: appliedDiscountNotice({ applied, lifetime, typedCode }),
    personalPending: !payerKnown && isPersonalPromo(row),
    target,
  };
}
