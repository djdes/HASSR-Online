import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { normalizeBaseIds } from "@/lib/mailing/bases";
import { mailingErrorResponse, readJson } from "@/lib/mailing/http.server";
import { listMailingBases, planQuickMailing, saveQuickDraft } from "@/lib/mailing/quick.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — базы адресов простого режима с числами (после загрузки новой базы). */
export async function GET() {
  await requireRoot();
  try {
    return NextResponse.json({ bases: await listMailingBases() });
  } catch (error) {
    return mailingErrorResponse(error, "quick bases");
  }
}

/**
 * POST { presetId, baseIds, campaignId?, save? } — охват готового письма по
 * выбранным базам; с `save: true` — ещё и черновик для теста и запуска.
 */
export async function POST(request: Request) {
  const session = await requireRoot();
  try {
    const body = await readJson(request);
    const input = {
      presetId: typeof body.presetId === "string" ? body.presetId : "",
      baseIds: normalizeBaseIds(body.baseIds),
    };
    if (body.save === true) {
      const r = await saveQuickDraft(
        { ...input, campaignId: typeof body.campaignId === "string" ? body.campaignId : null },
        { request, session }
      );
      return NextResponse.json({ stats: r.stats, deliverable: r.deliverable, campaignId: r.campaignId });
    }
    const r = await planQuickMailing(input);
    return NextResponse.json({ stats: r.stats, deliverable: r.deliverable });
  } catch (error) {
    return mailingErrorResponse(error, "quick");
  }
}
