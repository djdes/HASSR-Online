import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { badRequest, crmActor, crmErrorResponse, readJson } from "@/lib/crm/api.server";
import { dealPatchSchema } from "@/lib/crm/lifecycle/forms";
import { patchDeal } from "@/lib/crm/lifecycle/tasks.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/root/crm/deals/:id — колонка воронки, отказ, ответственный, «договор подписан». */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const parsed = dealPatchSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    await patchDeal(id, parsed.data, await crmActor(session));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
