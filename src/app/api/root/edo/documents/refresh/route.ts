import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { edoErrorResponse } from "@/lib/edo/api-response.server";
import { listEdoDocuments, refreshEdoDocuments } from "@/lib/edo/send.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ organizationId: z.string().trim().max(64).optional() }).nullable();

/**
 * POST {organizationId?} — «Обновить статусы»: перечитать в Saby неокончательные документы не
 * старше 90 дней (не больше 25 за раз). Вебхуков у Saby нет, поэтому только кнопкой.
 */
export async function POST(request: Request) {
  await requireRoot();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  const organizationId = (parsed.success && parsed.data?.organizationId) || undefined;
  try {
    const result = await refreshEdoDocuments({ organizationId });
    return NextResponse.json({ ...result, documents: await listEdoDocuments({ organizationId }) });
  } catch (e) {
    return edoErrorResponse(e, "documents refresh");
  }
}
