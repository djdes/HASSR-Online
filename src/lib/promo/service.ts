import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import {
  computeDiscountRub,
  isValidPromoCodeFormat,
  normalizePromoCode,
  validatePromo,
  type PromoRule,
} from "./rules";

/**
 * Промокод на сервере: найти, проверить, посчитать скидку от цены
 * подписки. Клиенту показываем результат этой же функции — сумма скидки
 * никогда не приходит от браузера.
 *
 * `subscriptionRub` — цена подписки уже С АКЦИЕЙ (lib/promo/offer.ts):
 * промокод действует поверх акции.
 */
export type PromoResolution =
  | { ok: true; code: string; discountRub: number; rule: PromoRule }
  | { ok: false; message: string };

/**
 * Заказ «состоялся»: `paid` — деньги пришли, `completed` — плюс новый
 * клиент дозаполнил профиль. Раньше считали только `paid`, и после
 * достройки профиля оплата выпадала из счётчика: лимит кода можно было
 * превысить, а «только новым» пропускал того, кто уже платил.
 */
export const PAID_ORDER_STATUSES = ["paid", "completed"] as const;

export async function resolvePromo(
  raw: string,
  context: {
    organizationId: string | null;
    subscriptionRub: number;
    /**
     * Почта заказа. Анонимный заказ (без входа) продлит организацию,
     * которой принадлежит эта почта, — поэтому «только новым» проверяем
     * и по ней, иначе постоянный клиент обходил ограничение, просто выйдя
     * из кабинета.
     */
    email?: string | null;
    now?: Date;
  }
): Promise<PromoResolution> {
  const code = normalizePromoCode(raw);
  if (!isValidPromoCodeFormat(code)) {
    console.info(`[promo] code rejected: bad format`);
    return { ok: false, message: "Такого промокода нет" };
  }
  const row = await db.promoCode.findUnique({ where: { code } });
  const rule: PromoRule | null = row
    ? {
        code: row.code,
        kind: row.kind === "fixed" ? "fixed" : "percent",
        value: row.value,
        active: row.active,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        maxUses: row.maxUses,
        newClientsOnly: row.newClientsOnly,
      }
    : null;
  const [paidUses, organizationPaid] = await Promise.all([
    rule
      ? db.paymentOrder.count({ where: { promoCode: rule.code, status: { in: [...PAID_ORDER_STATUSES] } } })
      : Promise.resolve(0),
    rule?.newClientsOnly
      ? hasPaidOrders({ organizationId: context.organizationId, email: context.email ?? null })
      : Promise.resolve(false),
  ]);
  const verdict = validatePromo(rule, {
    now: context.now ?? new Date(),
    paidUses,
    organizationHasPaidOrders: organizationPaid,
  });
  const scope = context.organizationId ? `org=${context.organizationId}` : "org=anon";
  if (!verdict.ok || !rule) {
    console.info(`[promo] code ${code} rejected: ${verdict.ok ? "not-found" : verdict.reason} ${scope}`);
    return { ok: false, message: verdict.ok ? "Такого промокода нет" : verdict.message };
  }
  const discountRub = computeDiscountRub(rule, context.subscriptionRub);
  if (discountRub <= 0) {
    console.info(`[promo] code ${code} rejected: no discount on ${context.subscriptionRub} ₽ ${scope}`);
    return { ok: false, message: "Промокод не даёт скидки на этот тариф" };
  }
  console.info(
    `[promo] code ${code} accepted: −${discountRub} ₽ of ${context.subscriptionRub} ₽ (uses ${paidUses}${rule.maxUses ? `/${rule.maxUses}` : ""}) ${scope}`
  );
  return { ok: true, code: rule.code, discountRub, rule };
}

/**
 * Были ли у клиента реальные (не тестовые) оплаты: по организации из
 * сессии, по почте заказа и по организации, которой эта почта принадлежит.
 */
async function hasPaidOrders(input: { organizationId: string | null; email: string | null }): Promise<boolean> {
  const email = input.email?.trim().toLowerCase() || null;
  const organizationIds = new Set<string>();
  if (input.organizationId) organizationIds.add(input.organizationId);
  if (email) {
    const user = await db.user.findUnique({ where: { email }, select: { organizationId: true } });
    if (user?.organizationId) organizationIds.add(user.organizationId);
  }
  const or: Prisma.PaymentOrderWhereInput[] = [];
  if (organizationIds.size > 0) or.push({ organizationId: { in: [...organizationIds] } });
  if (email) or.push({ email });
  if (or.length === 0) return false;
  const count = await db.paymentOrder.count({
    where: { status: { in: [...PAID_ORDER_STATUSES] }, isTest: false, OR: or },
  });
  return count > 0;
}

/** Сколько раз код оплачен — для таблицы ROOT. */
export async function promoPaidUses(codes: string[]): Promise<Record<string, number>> {
  if (codes.length === 0) return {};
  const rows = await db.paymentOrder.groupBy({
    by: ["promoCode"],
    where: { promoCode: { in: codes }, status: { in: [...PAID_ORDER_STATUSES] } },
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const row of rows) if (row.promoCode) out[row.promoCode] = row._count._all;
  return out;
}
