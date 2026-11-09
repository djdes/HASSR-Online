import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { badRequest, crmActor, crmErrorResponse, readJson } from "@/lib/crm/api.server";
import { offerSchema } from "@/lib/crm/lifecycle/forms";
import { sendSpecialOffer } from "@/lib/crm/lifecycle/offers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/root/crm/offers — спец-КП со скидкой из сделки: в пределах лимита
 * роли уходит сразу (код, КП, счёт), сверх — задача «Согласовать скидку».
 */
export async function POST(request: Request) {
  const session = await requireRoot();
  const parsed = offerSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    const result = await sendSpecialOffer(parsed.data, await crmActor(session));
    return NextResponse.json(result);
  } catch (error) {
    return crmErrorResponse(error);
  }
}
