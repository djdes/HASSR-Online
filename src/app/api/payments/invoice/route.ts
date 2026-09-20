import { NextResponse, after } from "next/server";

import { getActiveOrgId, isImpersonating, requireAuth } from "@/lib/auth-helpers";
import { createInvoiceOrder, deliverInvoice } from "@/lib/invoices/service";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { TARIFF_MONTHLY } from "@/lib/tariffs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/payments/invoice { tariffKey? } — выставить счёт по безналу
 * на активную организацию. Письмо со счётом и заметка админу — после
 * ответа: клиент не должен ждать SMTP.
 */
export async function POST(request: Request) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user) || isImpersonating(session)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { tariffKey?: unknown };
  const tariffKey = typeof body.tariffKey === "string" && body.tariffKey ? body.tariffKey : TARIFF_MONTHLY;
  const organizationId = getActiveOrgId(session);

  const result = await createInvoiceOrder({
    organizationId,
    userId: session.user.id,
    email: session.user.email ?? "",
    tariffKey,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  if (result.created) {
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    after(() =>
      deliverInvoice(result.order.id, org?.name ?? organizationId).catch((error) =>
        console.error("[invoices] deliver failed", error)
      )
    );
  }
  return NextResponse.json({
    orderId: result.order.id,
    amountRub: Number(result.order.amountRub),
    dueAt: result.order.invoiceDueAt,
    created: result.created,
    pdfUrl: `/api/payments/invoice/${result.order.id}/pdf`,
  });
}
