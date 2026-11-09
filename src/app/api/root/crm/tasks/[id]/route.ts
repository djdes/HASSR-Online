import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { badRequest, crmActor, crmErrorResponse, readJson } from "@/lib/crm/api.server";
import { taskPatchSchema } from "@/lib/crm/lifecycle/forms";
import { patchTask } from "@/lib/crm/lifecycle/tasks.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/root/crm/tasks/:id — перенести срок, переназначить. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const parsed = taskPatchSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    await patchTask(id, parsed.data, await crmActor(session));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
