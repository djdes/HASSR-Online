import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { clientProposalSchema, deliverableEmail } from "@/lib/client-documents";
import { CLIENT_PROPOSAL_AUDIT, sendClientProposal } from "@/lib/client-documents.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = clientProposalSchema.extend({
  to: z.array(z.string().trim().max(254)).min(1, "Укажите хотя бы один адрес почты").max(10, "Не больше 10 адресов"),
  subject: z.string().trim().min(1, "Укажите тему письма").max(200),
  message: z.string().trim().min(1, "Напишите текст письма").max(4000),
});

/**
 * POST — отправить КП письмом «от пользователя»: с личной почты сотрудника
 * (или с общей, ответы — ему), PDF во вложении. Пишется в аудит клиента.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  const to = [...new Set(parsed.data.to.map(deliverableEmail).filter((email): email is string => Boolean(email)))];
  if (!to.length) return NextResponse.json({ error: "Укажите настоящий адрес почты клиента" }, { status: 400 });
  const { to: _to, subject, message, ...input } = parsed.data;
  void _to;
  const sent = await sendClientProposal({ organizationId: id, input, to, subject, message, senderUserId: session.user.id });
  if (!sent) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  const { result, warnings } = sent;
  await recordAuditLog({
    request,
    session,
    organizationId: id,
    action: result.ok ? CLIENT_PROPOSAL_AUDIT : `${CLIENT_PROPOSAL_AUDIT}_failed`,
    entity: "Proposal",
    entityId: id,
    details: { to, plan: input.plan, promoCode: input.promoCode, extras: input.extras, ...(result.ok ? { via: result.via, from: result.from } : { error: result.error }) },
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 503 });
  return NextResponse.json({ ok: true, sentTo: to, via: result.via, from: result.from, fallbackReason: result.via === "system" ? result.fallbackReason : null, warnings });
}
