import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { MaxChannelError, publishPost } from "@/lib/max/channel.server";
import { maxChannelFailure } from "@/lib/max/channel-api.server";
import { assertQualityGate, qualityFor } from "@/lib/smm/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — опубликовать черновик, запланированный или упавший пост сейчас.
 * Через шлюз качества (B02): `{ force: true }` — подтверждение публикации
 * поста с блокирующими замечаниями. Пост на согласовании — сначала утвердить.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { force?: unknown };
    const force = body?.force === true;
    const post = await db.maxChannelPost.findUnique({ where: { id } });
    if (!post) throw new MaxChannelError("Пост не найден.", 404);
    if (post.status === "review") throw new MaxChannelError("Пост ждёт согласования — сначала утвердите его.", 409);
    const report = await qualityFor({ ...post, channelIds: [post.channelId], excludeIds: [id], scheduledAt: null });
    assertQualityGate(report, force);
    await db.maxChannelPost.update({
      where: { id },
      data: {
        qualityScore: report.score,
        qualityVerdict: report.verdict,
        ...(force && report.verdict === "block" ? { forcedById: session.user.id } : {}),
      },
    });
    const result = await publishPost(id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return maxChannelFailure(error);
  }
}
