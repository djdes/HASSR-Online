import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { pauseCampaign } from "@/lib/mailing/campaigns.server";
import { mailingErrorResponse } from "@/lib/mailing/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — пауза: очередь перестаёт отправлять, пока рассылку не продолжат. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ campaign: await pauseCampaign(id, { request, session }) });
  } catch (error) {
    return mailingErrorResponse(error, "pause");
  }
}
