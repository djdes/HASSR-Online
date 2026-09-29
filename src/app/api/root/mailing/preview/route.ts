import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { previewMailing, type PreviewRecipient } from "@/lib/mailing/campaigns.server";
import { mailingErrorResponse, readJson } from "@/lib/mailing/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { kind, payload, recipient } — как письмо и сообщения увидит выбранный получатель. */
export async function POST(request: Request) {
  await requireRoot();
  try {
    const body = await readJson(request);
    const r = body.recipient as { type?: unknown; id?: unknown } | null | undefined;
    const recipient: PreviewRecipient =
      r && (r.type === "user" || r.type === "contact") && typeof r.id === "string" ? { type: r.type, id: r.id } : null;
    const preview = await previewMailing({
      kind: typeof body.kind === "string" ? body.kind : "message",
      payload: body.payload,
      recipient,
    });
    return NextResponse.json(preview);
  } catch (error) {
    return mailingErrorResponse(error, "preview");
  }
}
