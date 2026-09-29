import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { normalizeSelection, reachForSelection } from "@/lib/mailing/audience.server";
import { mailingErrorResponse, readJson } from "@/lib/mailing/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { userIds, contactIds } — сколько выбранных реально получат по каждому каналу. */
export async function POST(request: Request) {
  await requireRoot();
  try {
    const stats = await reachForSelection(normalizeSelection(await readJson(request)));
    return NextResponse.json({ stats });
  } catch (error) {
    return mailingErrorResponse(error, "reach");
  }
}
