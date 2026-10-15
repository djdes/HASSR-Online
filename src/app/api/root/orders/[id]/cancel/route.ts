import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { cancelInvoice } from "@/lib/invoices/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — отменить неоплаченный счёт (клиент передумал или выставил новый). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id: raw } = await ctx.params;
  const orderId = Number.parseInt(raw, 10);
  if (!Number.isFinite(orderId)) return NextResponse.json({ error: "Не найдено", errorCode: "ROOT_ORDER_NOT_FOUND" }, { status: 404 });

  const cancelled = await cancelInvoice(orderId);
  if (!cancelled) return NextResponse.json({ error: "Отменить можно только неоплаченный счёт", errorCode: "ROOT_ORDER_CANCEL_UNPAID_ONLY" }, { status: 409 });
  const order = await db.paymentOrder.findUnique({ where: { id: orderId }, select: { organizationId: true } });
  await recordAuditLog({
    organizationId: order?.organizationId ?? "platform",
    session,
    request,
    action: "invoice.cancel",
    entity: "PaymentOrder",
    entityId: String(orderId),
  });
  return NextResponse.json({ ok: true, orderId, status: "cancelled" });
}
