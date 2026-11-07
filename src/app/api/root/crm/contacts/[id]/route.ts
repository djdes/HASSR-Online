import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { updateCrmContact } from "@/lib/crm/actions.server";
import { badRequest, crmActor, crmErrorResponse, readJson } from "@/lib/crm/api.server";
import { contactPatchSchema } from "@/lib/crm/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/root/crm/contacts/:id — стадия, ответственный, следующий шаг, данные, спам. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const parsed = contactPatchSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    await updateCrmContact(id, parsed.data, crmActor(session));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
