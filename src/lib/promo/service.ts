import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Промокоды на сервере — общие запросы к заказам. Сама проверка кода и
 * выбор скидки (промокод или скидка навсегда аккаунта, от цены с акцией)
 * — lib/promo/checkout.ts (`resolveCheckoutDiscount`): одна точка для
 * заказа, счёта, проверки кода и витрин. Сумма скидки никогда не
 * приходит от браузера.
 */

/**
 * Заказ «состоялся»: `paid` — деньги пришли, `completed` — плюс новый
 * клиент дозаполнил профиль. Раньше считали только `paid`, и после
 * достройки профиля оплата выпадала из счётчика: лимит кода можно было
 * превысить, а «только новым» пропускал того, кто уже платил.
 */
export const PAID_ORDER_STATUSES = ["paid", "completed"] as const;

/**
 * Были ли у клиента реальные (не тестовые) оплаты: по организации из
 * сессии, по почте заказа и по организации, которой эта почта принадлежит.
 * Анонимный заказ (без входа) продлит организацию этой почты — поэтому
 * «только новым» проверяем и по ней, иначе постоянный клиент обходил
 * ограничение, просто выйдя из кабинета.
 */
export async function hasPaidOrders(input: { organizationId: string | null; email: string | null }): Promise<boolean> {
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

/**
 * Сколько раз код оплачен (введён) — для таблицы ROOT. Продления со
 * скидкой навсегда (lifetimeDiscountId) использованием кода не считаются,
 * как и в проверке лимита (countPromoCodeUses).
 */
export async function promoPaidUses(codes: string[]): Promise<Record<string, number>> {
  if (codes.length === 0) return {};
  const rows = await db.paymentOrder.groupBy({
    by: ["promoCode"],
    where: { promoCode: { in: codes }, status: { in: [...PAID_ORDER_STATUSES] }, lifetimeDiscountId: null },
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const row of rows) if (row.promoCode) out[row.promoCode] = row._count._all;
  return out;
}
