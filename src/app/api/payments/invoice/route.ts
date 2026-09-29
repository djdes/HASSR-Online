import { NextResponse, after } from "next/server";

import { getActiveOrgId, isImpersonating, requireAuth } from "@/lib/auth-helpers";
import { createInvoiceOrder, deliverInvoice } from "@/lib/invoices/service";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { TARIFF_MONTHLY } from "@/lib/tariffs";
import { refuseMobileAppPayment } from "@/lib/mobile-app-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/payments/invoice { tariffKey?, promoCode? } — выставить счёт по
 * безналу на активную организацию. Сумму со скидкой (промокод или скидка
 * навсегда аккаунта) считает сервер. Письмо со счётом и заметка админу —
 * после ответа: клиент не должен ждать SMTP.
 */
export async function POST(request: Request) {
  const appRefusal = refuseMobileAppPayment(request);
  if (appRefusal) return appRefusal;
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user) || isImpersonating(session)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { tariffKey?: unknown; promoCode?: unknown };
  const tariffKey = typeof body.tariffKey === "string" && body.tariffKey ? body.tariffKey : TARIFF_MONTHLY;
  const promoCode = typeof body.promoCode === "string" && body.promoCode.trim() ? body.promoCode.slice(0, 64) : null;
  const organizationId = getActiveOrgId(session);

  const result = await createInvoiceOrder({
    organizationId,
    userId: session.user.id,
    email: session.user.email ?? "",
    tariffKey,
    promoCode,
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
