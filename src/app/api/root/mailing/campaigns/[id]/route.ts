import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import {
  deleteDraft,
  getCampaignCard,
  getDraft,
  toListRow,
  updateDraft,
  type RecipientFilter,
} from "@/lib/mailing/campaigns.server";
import { intParam, mailingErrorResponse, readJson } from "@/lib/mailing/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS: RecipientFilter[] = ["all", "queued", "sent", "failed", "skipped", "cancelled", "clicked", "test"];

/**
 * GET — карточка (получатели со статусами; `filter`, `search`, `offset`,
 * `limit`) или черновик целиком (`draft=1`). PATCH — сохранить черновик,
 * DELETE — удалить черновик.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await ctx.params;
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("draft") === "1") {
      const draft = await getDraft(id);
      if (!draft) return NextResponse.json({ error: "Рассылка не найдена" }, { status: 404 });
      return NextResponse.json({ draft });
    }
    const filterRaw = params.get("filter") as RecipientFilter | null;
    const card = await getCampaignCard(id, {
      filter: filterRaw && FILTERS.includes(filterRaw) ? filterRaw : "all",
      search: params.get("search") ?? "",
      offset: intParam(params.get("offset"), 0, 0, 1_000_000),
      limit: intParam(params.get("limit"), 50, 1, 200),
    });
    if (!card) return NextResponse.json({ error: "Рассылка не найдена" }, { status: 404 });
    return NextResponse.json(card);
  } catch (error) {
    return mailingErrorResponse(error, "campaign card");
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  try {
    const body = await readJson(request);
    const row = await updateDraft(
      id,
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
    return mailingErrorResponse(error, "draft update");
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  try {
    await deleteDraft(id, { request, session });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mailingErrorResponse(error, "draft delete");
  }
}
