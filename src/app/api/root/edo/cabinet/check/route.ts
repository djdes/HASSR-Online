import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { edoErrorResponse } from "@/lib/edo/api-response.server";
import { recheckEdoCabinet } from "@/lib/edo/cabinet.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — перепроверить кабинет сохранёнными ключами: свежий вход и новый список наших организаций. */
export async function POST() {
  await requireRoot();
  try {
    return NextResponse.json({ cabinet: await recheckEdoCabinet() });
  } catch (e) {
    return edoErrorResponse(e, "cabinet check");
  }
}
