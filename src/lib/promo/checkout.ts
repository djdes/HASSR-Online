import { db } from "@/lib/db";

import {
  resolveCheckoutDiscountWith,
  type CheckoutDeps,
  type CheckoutDiscountInput,
  type CheckoutDiscountResult,
  type CheckoutTarget,
  type PromoCodeRecord,
} from "./checkout-core";
import type { LifetimeDiscountView } from "./discounts";
import { hasPaidOrders, PAID_ORDER_STATUSES } from "./service";

/**
 * Скидка на оплату подписки с базой: введённый код и скидка навсегда
 * аккаунта → выгоднейшая (ядро — checkout-core.ts). Одна точка для
 * создания заказа, счёта по безналу, /api/promo/check, /order и
 * /settings/subscription.
 */

export async function findPromoCodeRecord(code: string): Promise<PromoCodeRecord | null> {
  const row = await db.promoCode.findUnique({ where: { code } });
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    kind: row.kind === "fixed" ? "fixed" : "percent",
    value: row.value,
    active: row.active,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    maxUses: row.maxUses,
    newClientsOnly: row.newClientsOnly,
    lifetime: row.lifetime,
    personalEmail: row.personalEmail,
    organizationId: row.organizationId,
  };
}

/**
 * Оплаченные заказы, где код ВВЕЛИ: авто-скидка навсегда (lifetimeDiscountId)
 * использованием кода не считается — иначе продления съедали бы лимит.
 */
export async function countPromoCodeUses(code: string): Promise<number> {
  return db.paymentOrder.count({
    where: { promoCode: code, status: { in: [...PAID_ORDER_STATUSES] }, lifetimeDiscountId: null },
  });
}

/**
 * Кого продлит заказ — как в fulfillPaidOrder: организация из сессии
 * руководителя, иначе организация пользователя с почтой заказа.
 */
export async function resolveCheckoutTarget(input: {
  organizationId: string | null;
  email: string | null;
}): Promise<CheckoutTarget> {
  const email = input.email?.trim().toLowerCase() || null;
  let organizationId = input.organizationId;
  if (!organizationId && email) {
    const user = await db.user.findUnique({ where: { email }, select: { organizationId: true } });
    organizationId = user?.organizationId ?? null;
  }
  if (!organizationId) {
    return { organizationId: null, accountId: null, emails: email ? [email] : [], organizationIds: [] };
  }
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      accountId: true,
      account: { select: { owner: { select: { email: true } }, organizations: { select: { id: true } } } },
    },
  });
  if (!org) return { organizationId: null, accountId: null, emails: email ? [email] : [], organizationIds: [] };
  const ownerEmail = org.account?.owner.email?.trim().toLowerCase() || null;
  return {
    organizationId: org.id,
    accountId: org.accountId,
    emails: [...new Set([email, ownerEmail].filter((value): value is string => Boolean(value)))],
    organizationIds: [...new Set([org.id, ...(org.account?.organizations.map((o) => o.id) ?? [])])],
  };
}

/** Действующая скидка навсегда аккаунта (отменённая — null). */
export async function readActiveLifetimeDiscount(accountId: string): Promise<LifetimeDiscountView | null> {
  const row = await db.accountLifetimeDiscount.findUnique({ where: { accountId } });
  if (!row || row.revokedAt) return null;
  return {
    id: row.id,
    code: row.code,
    kind: row.kind === "fixed" ? "fixed" : "percent",
    value: row.value,
    boundAt: row.boundAt.toISOString(),
  };
}

export const dbCheckoutDeps: CheckoutDeps = {
  findCode: findPromoCodeRecord,
  countCodeUses: countPromoCodeUses,
  hasPaidOrders,
  resolveTarget: resolveCheckoutTarget,
  activeLifetime: readActiveLifetimeDiscount,
};

/**
 * `scope` — откуда вызвали (order, invoice, check, page:/order, …) — для лога.
 * Ошибки базы не глотает: сумму к оплате нельзя «угадывать».
 */
export async function resolveCheckoutDiscount(
  input: CheckoutDiscountInput & { scope: string }
): Promise<CheckoutDiscountResult> {
  const result = await resolveCheckoutDiscountWith(dbCheckoutDeps, input);
  const who = `target org=${result.target.organizationId ?? "new"} account=${result.target.accountId ?? "-"}`;
  if (!result.ok) {
    console.info(`[promo] ${input.scope}: code ${result.typedCode} rejected (${result.reason}) ${who}`);
  } else if (result.applied) {
    const a = result.applied;
    console.info(
      `[promo] ${input.scope}: ${a.source === "lifetime" ? `lifetime ${a.code} (auto)` : `code ${a.code}${a.lifetime ? " (lifetime)" : ""}`}` +
        ` −${a.discountRub} ₽ of ${input.offerRub} ₽` +
        (result.typedCode && result.typedCode !== a.code ? `, typed ${result.typedCode} lost` : "") +
        (result.personalPending ? ", personal: check by email at payment" : "") +
        ` ${who}`
    );
  } else if (result.lifetime) {
    console.info(`[promo] ${input.scope}: lifetime ${result.lifetime.code} gives nothing on ${input.offerRub} ₽ ${who}`);
  }
  return result;
}
