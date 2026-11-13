import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { clientEmailSchema } from "@/lib/client-email";
import { clientEmailHistory, sendClientEmail } from "@/lib/client-email.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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
  const parsed = clientEmailSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  if (!await db.organization.findUnique({ where: { id }, select: { id: true } })) {
    return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  }
  const result = await sendClientEmail(id, session.user.id, parsed.data);
  if (!result) return NextResponse.json({ error: "Подключите и проверьте личную почту в разделе «Моя почта»" }, { status: 409 });
  if (!result.repeated) await recordAuditLog({
    request, session, organizationId: id, entity: "ClientEmail", entityId: result.item.id,
    action: `client_email.${result.item.status}`,
    details: { to: result.item.to, subject: result.item.subject, from: result.item.fromEmail },
  });
  return NextResponse.json(result, { status: result.item.status === "sending" ? 202 : 200 });
}
