import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { badRequest, crmActor, crmErrorResponse, readJson } from "@/lib/crm/api.server";
import { approvalDecisionSchema } from "@/lib/crm/lifecycle/forms";
import { decideApproval } from "@/lib/crm/lifecycle/offers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/root/crm/tasks/:id/approval — согласовать или отклонить скидку. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const parsed = approvalDecisionSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    const result = await decideApproval(id, parsed.data, await crmActor(session));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
