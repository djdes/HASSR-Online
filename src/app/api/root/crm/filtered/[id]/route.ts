import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { restoreFilteredMail } from "@/lib/crm/actions.server";
import { badRequest, crmActor, crmErrorResponse, readJson } from "@/lib/crm/api.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ allowSender: z.boolean().default(false) });

/** POST /api/root/crm/filtered/:id — вернуть отсеянное письмо (и всегда пропускать отправителя). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const parsed = Body.safeParse((await readJson(request)) ?? {});
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    const contactId = await restoreFilteredMail(id, parsed.data.allowSender, crmActor(session));
    return NextResponse.json({ contactId });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
