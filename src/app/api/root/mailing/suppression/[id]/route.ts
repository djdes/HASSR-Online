import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { removeSuppression } from "@/lib/mailing/contacts.server";
import { mailingErrorResponse } from "@/lib/mailing/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE — убрать адрес из стоп-листа (с записью в аудит). */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  try {
    await removeSuppression(id, { request, session });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mailingErrorResponse(error, "suppression remove");
  }
}
