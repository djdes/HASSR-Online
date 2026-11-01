import { NextResponse } from "next/server";

import { demoSlotDays } from "@/lib/demo-slots";
import { loadTakenDemoSlots } from "@/lib/demo-slots.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/demo-request/slots — свободное время показа на ближайшие рабочие дни. */
export async function GET() {
  const now = new Date();
  const taken = await loadTakenDemoSlots(now).catch((error: unknown) => {
    console.error("[demo-slots] taken slots failed", error);
    return new Set<string>();
  });
  return NextResponse.json(
    { timeZone: "Europe/Moscow", days: demoSlotDays(now, taken) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
