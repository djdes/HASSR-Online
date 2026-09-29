import { NextResponse, after } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { launchCampaign } from "@/lib/mailing/campaigns.server";
import { mailingErrorResponse, readJson } from "@/lib/mailing/http.server";
import { nudgeMailingQueue } from "@/lib/mailing/worker.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { mode: "now" | "schedule", scheduledAt?: "ГГГГ-ММ-ДДTЧЧ:ММ" (МСК) } —
 * поставить получателей в очередь. «Сейчас» — сразу толчок очереди после
 * ответа; дальше разбирает cron `/api/cron/mailing` с лимитом скорости.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  try {
    const body = await readJson(request);
    const mode = body.mode === "schedule" ? "schedule" : "now";
    const result = await launchCampaign(
      id,
      { mode, scheduledAtMsk: typeof body.scheduledAt === "string" ? body.scheduledAt : null },
      { request, session }
    );
    if (mode === "now") after(() => nudgeMailingQueue("launch"));
    return NextResponse.json(result);
  } catch (error) {
    return mailingErrorResponse(error, "launch");
  }
}
