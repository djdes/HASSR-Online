import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { runCrmCycle } from "@/lib/crm/cycle.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/root/crm/sync — «Обновить сейчас»: тот же прогон, что крон. */
export async function POST() {
  await requireRoot();
  const result = await runCrmCycle("manual");
  return NextResponse.json(result);
}
