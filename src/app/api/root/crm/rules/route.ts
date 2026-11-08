import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { addSenderRule } from "@/lib/crm/actions.server";
import { badRequest, crmActor, crmErrorResponse, readJson } from "@/lib/crm/api.server";
import { senderRuleSchema } from "@/lib/crm/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/root/crm/rules — адрес или домен: всегда отсеивать (block) или всегда принимать (allow). */
export async function POST(request: Request) {
  const session = await requireRoot();
  const parsed = senderRuleSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    await addSenderRule(parsed.data, await crmActor(session));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
