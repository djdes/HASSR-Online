import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { deliverableEmail } from "@/lib/client-documents";
import { CLIENT_INVOICE_AUDIT, sendClientInvoice } from "@/lib/client-documents.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  to: z.array(z.string().trim().max(254)).min(1, "Укажите хотя бы один адрес почты").max(10, "Не больше 10 адресов"),
  subject: z.string().trim().max(200).nullish(),
  message: z.string().trim().max(4000).nullish(),
});

/** POST — отправить счёт письмом с личной почты сотрудника (PDF во вложении). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; orderId: string }> }) {
  const session = await requireRoot();
  const { id, orderId } = await params;
  const order = Number(orderId);
  if (!Number.isInteger(order) || order <= 0) return NextResponse.json({ error: "Счёт не найден" }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  const to = [...new Set(parsed.data.to.map(deliverableEmail).filter((email): email is string => Boolean(email)))];
  if (!to.length) return NextResponse.json({ error: "Укажите настоящий адрес почты клиента" }, { status: 400 });
  const sent = await sendClientInvoice({
    organizationId: id,
    orderId: order,
    to,
    subject: parsed.data.subject ?? null,
    message: parsed.data.message ?? null,
    senderUserId: session.user.id,
  });
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status });
  const { result } = sent;
  await recordAuditLog({
    request,
    session,
    organizationId: id,
    action: result.ok ? CLIENT_INVOICE_AUDIT : `${CLIENT_INVOICE_AUDIT}_failed`,
    entity: "PaymentOrder",
    entityId: String(order),
    details: { to, ...(result.ok ? { via: result.via, from: result.from } : { error: result.error }) },
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 503 });
  return NextResponse.json({ ok: true, sentTo: to, via: result.via, from: result.from, fallbackReason: result.via === "system" ? result.fallbackReason : null });
}
