import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { mailSenderSchema } from "@/lib/platform-mail";
import { MailSenderError, disableMailSender, readMailSender, saveMailSender } from "@/lib/platform-mail.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Моя почта» — personal SMTP of the signed-in panel user.
 *   GET — settings (no password); PUT — save; DELETE — switch off (system mail).
 */

export async function GET() {
  const session = await requireRoot();
  return NextResponse.json({ sender: await readMailSender(session.user.id) });
}

export async function PUT(request: Request) {
  const session = await requireRoot();
  const parsed = mailSenderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return NextResponse.json({ error: "Проверьте поля формы", fieldErrors }, { status: 400 });
  }
  try {
    await saveMailSender(session.user.id, parsed.data);
  } catch (error) {
    if (error instanceof MailSenderError) return NextResponse.json({ error: error.message, fieldErrors: { password: error.message } }, { status: 400 });
    throw error;
  }
  return NextResponse.json({ sender: await readMailSender(session.user.id) });
}

export async function DELETE() {
  const session = await requireRoot();
  await disableMailSender(session.user.id);
  return NextResponse.json({ sender: await readMailSender(session.user.id) });
}
