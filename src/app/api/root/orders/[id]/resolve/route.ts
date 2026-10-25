import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { returnRefundedOrderPoints } from "@/lib/balance/checkout";
import { accrueReferralReward } from "@/lib/balance/referral";
import { db } from "@/lib/db";
import { markOrderRefunded } from "@/lib/partners/accruals";
import { bindLifetimeDiscountForOrder } from "@/lib/promo/lifetime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { outcome: "applied" | "refunded" } — оплата устаревшего заказа
 * (`heldAt`) разобрана вручную: тариф применён формой подписки или деньги
 * возвращены. Снимает «ждёт разбора»: после «применено» по заказу выпускается
 * УПД, привязывается скидка навсегда и начисляется реферальная награда (их
 * при оплате пропустили); после «возврат» заказ помечен возвращённым
 * (документ аннулируется, партнёрские начисления сторнируются), баллы,
 * списанные в оплату, возвращаются на баланс.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id: raw } = await ctx.params;
  const orderId = Number.parseInt(raw, 10);
  if (!Number.isFinite(orderId)) return NextResponse.json({ error: "Не найдено", errorCode: "ROOT_ORDER_NOT_FOUND" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { outcome?: unknown } | null;
  const outcome = body?.outcome;
  if (outcome !== "applied" && outcome !== "refunded") {
    return NextResponse.json({ error: "outcome: applied | refunded", errorCode: "ROOT_ORDER_RESOLVE_INVALID" }, { status: 400 });
  }

  const order = await db.paymentOrder.findUnique({
    where: { id: orderId },
    select: { status: true, heldAt: true, organizationId: true, description: true, pointsSpent: true },
  });
  if (!order) return NextResponse.json({ error: "Не найдено", errorCode: "ROOT_ORDER_NOT_FOUND" }, { status: 404 });
  const notHeld = NextResponse.json(
    { error: "Разобрать можно только оплату, которая ждёт разбора", errorCode: "ROOT_ORDER_NOT_HELD" },
    { status: 409 },
  );
  if (order.status !== "paid" || !order.heldAt) return notHeld;

  // Снимаем отметку условием в where: повторный клик ничего не тронет.
  const cleared = await db.paymentOrder.updateMany({ where: { id: orderId, heldAt: { not: null } }, data: { heldAt: null } });
  if (cleared.count === 0) return notHeld;
  let pointsReturned = false;
  if (outcome === "refunded") {
    try {
      await markOrderRefunded(orderId);
    } catch (error) {
      // Возврат не отмечен — заказ снова ждёт разбора, а не выглядит обычной оплатой.
      await db.paymentOrder.update({ where: { id: orderId }, data: { heldAt: order.heldAt } });
      console.error("[billing] held order refund mark failed", { orderId, error });
      return NextResponse.json({ error: "Не удалось отметить возврат", errorCode: "ROOT_ORDER_RESOLVE_FAILED" }, { status: 500 });
    }
    pointsReturned = await returnRefundedOrderPoints({ id: orderId, pointsSpent: order.pointsSpent, organizationId: order.organizationId }).catch(
      (error) => {
        console.error("[billing] held order points return failed", { orderId, error });
        return false;
      },
    );
  } else {
    // Пропущенное при оплате на разборе — как после обычной оплаты (оба шага
    // идемпотентны и best-effort: тариф уже применён руками).
    await bindLifetimeDiscountForOrder(orderId, order.organizationId);
    await accrueReferralReward(orderId).catch((error) => console.error("[billing] held order referral reward failed", { orderId, error }));
  }

  await recordAuditLog({
    organizationId: order.organizationId ?? "platform",
    session,
    request,
    action: "billing.order-resolved",
    entity: "PaymentOrder",
    entityId: String(orderId),
    details: {
      orderId,
      outcome,
      description: order.description,
      heldAt: order.heldAt.toISOString(),
      ...(pointsReturned ? { pointsReturned: order.pointsSpent } : {}),
    },
  });
  return NextResponse.json({ ok: true, orderId, outcome, ...(pointsReturned ? { pointsReturned: order.pointsSpent } : {}) });
}
