import { NextResponse } from "next/server";

import { requireRoot, requireSuperRoot } from "@/lib/auth-helpers";
import { badRequest, crmErrorResponse, readJson } from "@/lib/crm/api.server";
import { mailboxInputSchema } from "@/lib/crm/mailbox";
import { createMailbox, listMailboxes } from "@/lib/crm/mailbox.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — ящики CRM (без паролей); POST — добавить ящик (только владелец платформы). */
export async function GET() {
  await requireRoot();
  return NextResponse.json({ mailboxes: await listMailboxes() });
}

export async function POST(request: Request) {
  const session = await requireSuperRoot();
  const parsed = mailboxInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    return NextResponse.json({ mailbox: await createMailbox(parsed.data, session.user.id) });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
