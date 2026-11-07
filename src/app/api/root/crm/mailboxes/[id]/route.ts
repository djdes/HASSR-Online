import { NextResponse } from "next/server";

import { requireSuperRoot } from "@/lib/auth-helpers";
import { badRequest, crmErrorResponse, readJson } from "@/lib/crm/api.server";
import { mailboxInputSchema } from "@/lib/crm/mailbox";
import { deleteMailbox, updateMailbox } from "@/lib/crm/mailbox.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT — изменить ящик (пустой пароль = прежний), DELETE — удалить. Только владелец платформы. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperRoot();
  const { id } = await params;
  const parsed = mailboxInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    return NextResponse.json({ mailbox: await updateMailbox(id, parsed.data) });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperRoot();
  const { id } = await params;
  await deleteMailbox(id);
  return NextResponse.json({ ok: true });
}
