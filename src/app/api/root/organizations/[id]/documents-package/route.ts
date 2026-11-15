import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { deliverableEmail } from "@/lib/client-documents";
import { PACKAGE_DOC_KINDS } from "@/lib/client-documents-package";
import { CLIENT_PACKAGE_AUDIT, sendClientDocumentsPackage } from "@/lib/client-documents-package.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  docs: z.array(z.enum(PACKAGE_DOC_KINDS)).min(1, "Выберите хотя бы один документ").max(3),
  to: z.array(z.string().trim().max(254)).min(1, "Укажите хотя бы один адрес почты").max(10, "Не больше 10 адресов"),
  subject: z.string().trim().max(200).nullish(),
  message: z.string().trim().max(4000).nullish(),
  /** Документы без факсимиле и печати. */
  plain: z.boolean().optional(),
});

/** POST — пакет документов клиенту одним письмом (договор, счёт, карточка реквизитов). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  const to = [...new Set(parsed.data.to.map(deliverableEmail).filter((email): email is string => Boolean(email)))];
  if (!to.length) return NextResponse.json({ error: "Укажите настоящий адрес почты клиента" }, { status: 400 });
  const sent = await sendClientDocumentsPackage({
    organizationId: id,
    docs: parsed.data.docs,
    to,
    subject: parsed.data.subject ?? null,
    message: parsed.data.message ?? null,
    plain: parsed.data.plain === true,
    senderUserId: session.user.id,
  });
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status });
  const { result } = sent;
  await recordAuditLog({
    request,
    session,
    organizationId: id,
    action: result.ok ? CLIENT_PACKAGE_AUDIT : `${CLIENT_PACKAGE_AUDIT}_failed`,
    entity: "Organization",
    entityId: id,
    details: { to, files: sent.files, contractId: sent.contractId, invoiceId: sent.invoiceId, plain: parsed.data.plain === true, ...(result.ok ? { via: result.via, from: result.from } : { error: result.error }) },
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 503 });
  return NextResponse.json({ ok: true, sentTo: to, files: sent.files, via: result.via, from: result.from, fallbackReason: result.via === "system" ? result.fallbackReason : null });
}
