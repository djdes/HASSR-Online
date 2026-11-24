import { NextResponse, after } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { resumeCampaign } from "@/lib/mailing/campaigns.server";
import { mailingErrorResponse } from "@/lib/mailing/http.server";
import { nudgeMailingQueue } from "@/lib/mailing/worker.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — продолжить рассылку с паузы; идущая — сразу толчок очереди. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  try {
    const campaign = await resumeCampaign(id, { request, session });
    if (campaign.status === "sending") after(() => nudgeMailingQueue("launch"));
    return NextResponse.json({ campaign });
  } catch (error) {
    return mailingErrorResponse(error, "resume");
  }
}
