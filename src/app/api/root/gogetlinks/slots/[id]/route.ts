import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRoot } from "@/lib/auth-helpers";
import { GglIsolationError } from "@/lib/seo/gogetlinks-client.server";
import {
  GglOrderError,
  mutatePlannedSlot,
  resolveGglActorFromSession,
  serializePlannedSlot,
} from "@/lib/seo/gogetlinks-orders.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const articlePatchSchema = z.object({
  title: z.string().trim().min(3).max(300).optional(),
  announcement: z.string().trim().min(3).max(1500).optional(),
  bodyHtml: z.string().trim().min(10).max(60_000).optional(),
  metaTitle: z.string().trim().max(300).optional(),
  metaDescription: z.string().trim().max(500).optional(),
  metaKeywords: z.string().trim().max(500).optional(),
  anchor: z.string().trim().min(1).max(200).optional(),
  anchorKind: z.enum(["exact", "diluted", "url_brand"]).optional(),
  briefText: z.string().trim().max(3000).optional(),
});

const mutateSlotBodySchema = z.object({
  action: z.enum(["skip", "swap_donor", "update_article"]),
  donorSiteId: z.number().int().positive().optional(),
  articlePatch: articlePatchSchema.optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireRoot();
  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Не указан идентификатор слота" }, { status: 400 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = mutateSlotBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные параметры изменения слота" },
      { status: 400 },
    );
  }

  try {
    const actor = await resolveGglActorFromSession(session);
    const slot = await mutatePlannedSlot({
      slotId: id,
      action: parsed.data.action,
      donorSiteId: parsed.data.donorSiteId,
      articlePatch: parsed.data.articlePatch,
      actor,
    });
    return NextResponse.json({ slot: serializePlannedSlot(slot) });
  } catch (err) {
    if (err instanceof GglOrderError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof GglIsolationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[ggl-slot-mutate] unexpected error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Не удалось обновить слот плана закупок",
      },
      { status: 500 },
    );
  }
}
