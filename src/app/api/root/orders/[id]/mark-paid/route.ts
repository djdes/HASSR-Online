import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { markInvoicePaid } from "@/lib/invoices/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — деньги по счёту пришли на расчётный счёт: ROOT подтверждает, дальше всё как после кассы. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id: raw } = await ctx.params;
  const orderId = Number.parseInt(raw, 10);
  if (!Number.isFinite(orderId)) return NextResponse.json({ error: "Не найдено", errorCode: "ROOT_ORDER_NOT_FOUND" }, { status: 404 });

  const result = await markInvoicePaid(orderId, session.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error, errorCode: "ROOT_INVOICE_ACTION_FAILED" }, { status: result.status });

  await recordAuditLog({
    organizationId: result.order.organizationId ?? "platform",
    session,
    request,
    action: "invoice.mark-paid",
    entity: "PaymentOrder",
    entityId: String(orderId),
    details: { amountRub: Number(result.order.amountRub), tariffKey: result.order.tariffKey },
  });
  return NextResponse.json({ ok: true, orderId, status: "paid" });
}
