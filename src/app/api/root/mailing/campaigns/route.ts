import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { createDraft, listCampaigns, toListRow } from "@/lib/mailing/campaigns.server";
import { mailingErrorResponse, readJson } from "@/lib/mailing/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — история рассылок (и черновики); POST — новый черновик. */
export async function GET() {
  await requireRoot();
  try {
    return NextResponse.json({ campaigns: await listCampaigns() });
  } catch (error) {
    return mailingErrorResponse(error, "campaigns list");
  }
}

export async function POST(request: Request) {
  const session = await requireRoot();
  try {
    const body = await readJson(request);
    const row = await createDraft(
      {
        title: typeof body.title === "string" ? body.title : "",
        kind: typeof body.kind === "string" ? body.kind : "message",
        channels: body.channels,
        payload: body.payload,
        audience: body.audience,
      },
      { request, session }
    );
    return NextResponse.json({ campaign: toListRow(row) });
  } catch (error) {
    return mailingErrorResponse(error, "draft create");
  }
}
