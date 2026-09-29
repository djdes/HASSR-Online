import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { cancelCampaign } from "@/lib/mailing/campaigns.server";
import { mailingErrorResponse } from "@/lib/mailing/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — отменить: всё, что ещё не отправлено, останется неотправленным. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ campaign: await cancelCampaign(id, { request, session }) });
  } catch (error) {
    return mailingErrorResponse(error, "cancel");
  }
}
