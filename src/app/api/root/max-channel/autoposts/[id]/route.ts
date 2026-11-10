import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { cancelAutopost, loadAutopostViews, regenerateAutopost } from "@/lib/channel-autopost/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["regenerate", "new-topic", "cancel"]) });

/**
 * POST /api/root/max-channel/autoposts/<id> — `regenerate` (та же тема,
 * новые текст и фото), `new-topic` (другая тема), `cancel` (в этот день не
 * публиковать). Запланированные посты автопоста при этом снимаются.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  try {
    if (parsed.data.action === "cancel") await cancelAutopost(id);
    else await regenerateAutopost(id, { newTopic: parsed.data.action === "new-topic" });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || "Не получилось" }, { status: 409 });
  }
  return NextResponse.json({ items: await loadAutopostViews() });
}
