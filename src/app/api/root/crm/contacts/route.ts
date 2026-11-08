import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { createManualLead } from "@/lib/crm/actions.server";
import { badRequest, crmActor, crmErrorResponse, readJson } from "@/lib/crm/api.server";
import { manualLeadSchema } from "@/lib/crm/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/root/crm/contacts — лид вручную (WhatsApp, VK, MAX, звонок…). */
export async function POST(request: Request) {
  const session = await requireRoot();
  const parsed = manualLeadSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    const id = await createManualLead(parsed.data, await crmActor(session));
    return NextResponse.json({ id });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
