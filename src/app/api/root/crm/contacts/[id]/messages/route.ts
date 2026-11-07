import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { addContactMessage } from "@/lib/crm/actions.server";
import { badRequest, crmActor, crmErrorResponse, readJson } from "@/lib/crm/api.server";
import { contactMessageSchema } from "@/lib/crm/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/root/crm/contacts/:id/messages — письмо, Telegram, звонок, заметка, «ответ не нужен». */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const parsed = contactMessageSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    const result = await addContactMessage(id, parsed.data, crmActor(session));
    return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: 422 });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
