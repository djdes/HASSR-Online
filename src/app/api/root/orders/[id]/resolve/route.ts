import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { markOrderRefunded } from "@/lib/partners/accruals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { outcome: "applied" | "refunded" } — оплата устаревшего заказа
 * (`heldAt`) разобрана вручную: тариф применён формой подписки или деньги
 * возвращены. Снимает «ждёт разбора»: после «применено» по заказу выпускается
 * УПД, после «возврат» заказ помечен возвращённым (документ аннулируется,
 * начисления сторнируются).
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
    select: { status: true, heldAt: true, organizationId: true, description: true },
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
  if (outcome === "refunded") {
    try {
      await markOrderRefunded(orderId);
    } catch (error) {
      // Возврат не отмечен — заказ снова ждёт разбора, а не выглядит обычной оплатой.
      await db.paymentOrder.update({ where: { id: orderId }, data: { heldAt: order.heldAt } });
      console.error("[billing] held order refund mark failed", { orderId, error });
      return NextResponse.json({ error: "Не удалось отметить возврат", errorCode: "ROOT_ORDER_RESOLVE_FAILED" }, { status: 500 });
    }
  }

  await recordAuditLog({
    organizationId: order.organizationId ?? "platform",
    session,
    request,
    action: "billing.order-resolved",
    entity: "PaymentOrder",
    entityId: String(orderId),
    details: { orderId, outcome, description: order.description, heldAt: order.heldAt.toISOString() },
  });
  return NextResponse.json({ ok: true, orderId, outcome });
}
