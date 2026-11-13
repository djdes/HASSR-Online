import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { mailWorkspaceSchema } from "@/lib/mail-workspace";
import { MailWorkspaceError, sendWorkspaceMail, workspaceMailHistory } from "@/lib/mail-workspace.server";
import { recordAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const session = await requireRoot();
  try {
    return NextResponse.json(await workspaceMailHistory(session, new URL(request.url).searchParams.get("cursor")));
  } catch (error) {
    if (error instanceof MailWorkspaceError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function POST(request: Request) {
  const session = await requireRoot();
  const parsed = mailWorkspaceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля письма" }, { status: 400 });
  try {
    const result = await sendWorkspaceMail(session, parsed.data);
    for (const item of result.items) await recordAuditLog({
      request, session, organizationId: item.organizationId, entity: "ClientEmail", entityId: item.id,
      action: "client_email.workspace_result", details: { status: item.status, from: item.fromEmail, to: item.to },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MailWorkspaceError) return NextResponse.json({ error: error.message }, { status: error.status });
    // The client keeps the same request key and refreshes history after an uncertain result.
    return NextResponse.json({ error: "Результат отправки не подтверждён. Обновите историю перед повторной попыткой." }, { status: 503 });
  }
}
