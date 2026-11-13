import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { mailWorkspaceContentSchema } from "@/lib/mail-workspace";
import { MailWorkspaceError, validateMailRecipients } from "@/lib/mail-workspace.server";
import { clientEmailPreview } from "@/lib/client-email.server";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const session = await requireRoot();
  const parsed = mailWorkspaceContentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля письма" }, { status: 400 });
  try {
    await validateMailRecipients(session, parsed.data);
    const result = await clientEmailPreview(session.user.id, parsed.data);
    if (!result) return NextResponse.json({ error: "Проверьте выбранный ящик в разделе «Моя почта»." }, { status: 409 });
    return NextResponse.json({ html: result.html });
  } catch (error) {
    if (error instanceof MailWorkspaceError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
