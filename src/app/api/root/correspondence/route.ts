import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { mailWorkspaceSchema } from "@/lib/mail-workspace";
import { MailWorkspaceError, sendWorkspaceMail, workspaceMailHistory } from "@/lib/mail-workspace.server";
import { recordAuditLog } from "@/lib/audit-log";
import { MailAttachmentError, readMailRequest } from "@/lib/mail-attachments.server";

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
  try {
    const { content, attachments } = await readMailRequest(request);
    const parsed = mailWorkspaceSchema.safeParse(content);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля письма" }, { status: 400 });
    const result = await sendWorkspaceMail(session, parsed.data, attachments);
    for (const item of result.items) await recordAuditLog({
      request, session, organizationId: item.organizationId ?? (process.env.PLATFORM_ORG_ID || "platform"), entity: "ClientEmail", entityId: item.id,
      action: "client_email.workspace_result", details: { status: item.status, from: item.fromEmail, to: item.to },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MailWorkspaceError || error instanceof MailAttachmentError) return NextResponse.json({ error: error.message }, { status: error.status });
    // The client keeps the same request key and refreshes history after an uncertain result.
    return NextResponse.json({ error: "Результат отправки не подтверждён. Обновите историю перед повторной попыткой." }, { status: 503 });
  }
}
