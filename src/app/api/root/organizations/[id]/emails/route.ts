import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { clientEmailSchema } from "@/lib/client-email";
import { clientEmailHistory, sendClientEmail } from "@/lib/client-email.server";
import { MailAttachmentError, readMailRequest } from "@/lib/mail-attachments.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  await requireRoot();
  const { id } = await params;
  if (!await db.organization.findUnique({ where: { id }, select: { id: true } })) {
    return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  }
  return NextResponse.json(await clientEmailHistory(id, new URL(request.url).searchParams.get("cursor")));
}

export async function POST(request: Request, { params }: Context) {
  const session = await requireRoot();
  const { id } = await params;
  // JSON или multipart (`content` + `files`): вложения — те же правила, что в разделе «Письма».
  let body: Awaited<ReturnType<typeof readMailRequest>>;
  try {
    body = await readMailRequest(request);
  } catch (error) {
    if (error instanceof MailAttachmentError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const parsed = clientEmailSchema.safeParse(body.content);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  if (!await db.organization.findUnique({ where: { id }, select: { id: true } })) {
    return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  }
  const result = await sendClientEmail(id, session.user.id, parsed.data, body.attachments);
  if (!result) return NextResponse.json({ error: "Подключите и проверьте личную почту в разделе «Моя почта»" }, { status: 409 });
  if (!result.repeated) await recordAuditLog({
    request, session, organizationId: id, entity: "ClientEmail", entityId: result.item.id,
    action: `client_email.${result.item.status}`,
    details: { to: result.item.to, subject: result.item.subject, from: result.item.fromEmail, attachments: body.attachments.length },
  });
  return NextResponse.json(result, { status: result.item.status === "sending" ? 202 : 200 });
}
