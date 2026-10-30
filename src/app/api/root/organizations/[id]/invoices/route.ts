import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { deliverableEmail } from "@/lib/client-documents";
import { issueClientInvoice } from "@/lib/client-documents.server";
import { MAX_POINTS } from "@/lib/tariff-plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  tier: z.enum(["standard", "premium"]),
  cycle: z.enum(["month", "year"]),
  points: z.number().int().min(1).max(MAX_POINTS).default(1),
  promoCode: z.string().trim().max(64).nullish().transform((value) => value || null),
  payerEmail: z.string().trim().max(254).nullish().transform((value) => value || null),
});

/**
 * POST /api/root/organizations/[id]/invoices — выставить клиенту счёт по
 * безналу (тот же путь, что кнопка «Счёт для юрлица» в кабинете клиента):
 * pending-заказ, сумма по тарифу и текущей подписке. Раздел «Оплаты».
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  const result = await issueClientInvoice({
    organizationId: id,
    tier: parsed.data.tier,
    cycle: parsed.data.cycle,
    points: parsed.data.points,
    promoCode: parsed.data.promoCode,
    payerEmail: deliverableEmail(parsed.data.payerEmail),
    issuedByUserId: session.user.id,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  await recordAuditLog({
    request,
    session,
    organizationId: id,
    action: "client_invoice.issue",
    entity: "PaymentOrder",
    entityId: String(result.order.id),
    details: { tariffKey: result.order.tariffKey, points: result.order.points, amountRub: Number(result.order.amountRub), created: result.created },
  });
  return NextResponse.json({
    orderId: result.order.id,
    amountRub: Number(result.order.amountRub),
    created: result.created,
    description: result.order.description,
    pdfUrl: `/api/root/organizations/${id}/invoices/${result.order.id}/pdf`,
  });
}
