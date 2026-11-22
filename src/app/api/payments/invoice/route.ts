import { NextResponse, after } from "next/server";

import { getActiveOrgId, isImpersonating, requireAuth } from "@/lib/auth-helpers";
import { createInvoiceOrder, deliverInvoice } from "@/lib/invoices/service";
import { fillOrganizationInn } from "@/lib/invoices/org-buyer.server";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { parseCheckoutTarget } from "@/lib/plan-checkout.server";
import { refuseMobileAppPayment } from "@/lib/mobile-app-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/payments/invoice { plan?, cycle?, points?, tariffKey?, promoCode?, buyer? } —
 * выставить счёт по безналу на активную организацию. Сумму по тарифу и виду
 * перехода, со скидкой (промокод или скидка навсегда аккаунта), считает
 * сервер (`quoteCheckout`). Без тарифа — «Стандарт» за год. Письмо со счётом
 * и заметка админу — после ответа: клиент не должен ждать SMTP.
 */
export async function POST(request: Request) {
  const appRefusal = refuseMobileAppPayment(request);
  if (appRefusal) return appRefusal;
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user) || isImpersonating(session)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const target = parseCheckoutTarget({ plan: body.plan, cycle: body.cycle, points: body.points, tariffKey: body.tariffKey }) ?? {
    tier: "standard" as const,
    cycle: "year" as const,
    points: 1,
  };
  const promoCode = typeof body.promoCode === "string" && body.promoCode.trim() ? body.promoCode.slice(0, 64) : null;
  const organizationId = getActiveOrgId(session);

  // /order: у организации нет ИНН — его ввели прямо в форме счёта. Записываем
  // (журнал действий, сверка пробного), затем выставляем счёт на него.
  const buyer = body.buyer && typeof body.buyer === "object" ? (body.buyer as Record<string, unknown>) : null;
  if (buyer && typeof buyer.inn === "string" && buyer.inn.trim()) {
    const filled = await fillOrganizationInn({
      organizationId,
      inn: buyer.inn,
      companyName: typeof buyer.companyName === "string" ? buyer.companyName : null,
      session,
      request,
    });
    if (!filled.ok) {
      return NextResponse.json({ error: filled.error, ...(filled.code ? { code: filled.code } : {}) }, { status: filled.status });
    }
  }

  const result = await createInvoiceOrder({
    organizationId,
    userId: session.user.id,
    email: session.user.email ?? "",
    target,
    promoCode,
    expectedGrossRub: typeof body.expectedGrossRub === "number" ? body.expectedGrossRub : null,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.grossRub !== undefined ? { grossRub: result.grossRub } : {}) },
      { status: result.status }
    );
  }

  // Клиент сам выбрал «оплатить по счёту»: даже если вернулся счёт, который
  // выставил сценарий CRM, теперь это его решение — окно и автопереход ждут.
  await db.crmReminderLog.deleteMany({ where: { dedupeKey: `lc:invoice:${result.order.id}` } }).catch(() => undefined);

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
    email: result.order.email,
  });
}
