import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { normalizeEmail } from "@/lib/crm/identity";
import { db } from "@/lib/db";
import { readGuestBuyer, verifyGuestInvoice } from "@/lib/invoices/guest";
import { sendInvoiceCopy } from "@/lib/invoices/service";
import { invoiceSendRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/payments/invoice/<id>/send { email, sig? } — «Отправить на другую
 * почту» после выставления счёта на /order (бухгалтеру). Счёт гостя — только
 * с подписью его ссылки на PDF (`sig`, как у guest-pdf); счёт организации —
 * руководителю этой организации, не в режиме «войти как». Чужой, отменённый,
 * оплаченный — 404/410, как будто счёта нет. Пять писем за 10 минут на счёт.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  const orderId = Number.parseInt(raw, 10);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const to = normalizeEmail(typeof body.email === "string" ? body.email : null);
  if (!Number.isFinite(orderId)) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  if (!to) return NextResponse.json({ error: "Укажите почту, например buh@company.ru" }, { status: 400 });

  const order = await db.paymentOrder.findUnique({
    where: { id: orderId },
    select: { email: true, organizationId: true, paymentMethod: true, status: true, buyerJson: true },
  });
  if (!order || order.paymentMethod !== "invoice") return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const signature = typeof body.sig === "string" ? body.sig : "";
  let allowed = false;
  if (signature && !order.organizationId && readGuestBuyer(order.buyerJson)) {
    allowed = verifyGuestInvoice(orderId, order.email, signature);
  } else if (order.organizationId) {
    const session = await getServerSession(authOptions).catch(() => null);
    allowed =
      Boolean(session?.user) &&
      !isImpersonating(session!) &&
      hasFullWorkspaceAccess(session!.user) &&
      getActiveOrgId(session!) === order.organizationId;
  }
  if (!allowed) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  if (order.status !== "pending") return NextResponse.json({ error: "Счёт уже не действует" }, { status: 410 });
  if (!invoiceSendRateLimiter.consume(`invoice-send:${orderId}`)) {
    return NextResponse.json({ error: "Слишком много писем подряд — подождите несколько минут" }, { status: 429 });
  }

  const sent = await sendInvoiceCopy(orderId, to).catch((error) => {
    console.error("[invoices] copy send failed", { orderId, error });
    return false;
  });
  if (!sent) return NextResponse.json({ error: "Письмо не ушло — попробуйте ещё раз или скачайте PDF" }, { status: 502 });
  console.info(`[invoices] invoice #${orderId} copy sent to another address`);
  return NextResponse.json({ ok: true, email: to });
}
