import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { deleteSenderRule } from "@/lib/crm/actions.server";
import { crmActor, crmErrorResponse } from "@/lib/crm/api.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/root/crm/rules/:id */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  try {
    await deleteSenderRule(id, await crmActor(session));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
