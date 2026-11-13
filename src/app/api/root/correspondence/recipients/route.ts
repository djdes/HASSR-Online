import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { MailWorkspaceError, mailRecipientDirectory } from "@/lib/mail-workspace.server";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const session = await requireRoot();
  try {
    return NextResponse.json(await mailRecipientDirectory(session, new URL(request.url).searchParams.get("q") ?? ""));
  } catch (error) {
    if (error instanceof MailWorkspaceError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
