import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { badRequest, crmActor, crmErrorResponse, readJson } from "@/lib/crm/api.server";
import { manualTaskSchema } from "@/lib/crm/lifecycle/forms";
import { createManualTask } from "@/lib/crm/lifecycle/tasks.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/root/crm/tasks — своя задача (к контакту или сделке). */
export async function POST(request: Request) {
  const session = await requireRoot();
  const parsed = manualTaskSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    const id = await createManualTask(parsed.data, await crmActor(session));
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
