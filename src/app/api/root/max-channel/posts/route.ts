import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { maxPostDraftSchema } from "@/lib/max/channel-post";
import { MaxChannelError, publishPost } from "@/lib/max/channel.server";
import { maxChannelFailure } from "@/lib/max/channel-api.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.enum(["draft", "schedule", "publish"]);

/**
 * POST /api/root/max-channel/posts — новый пост в канал MAX.
 * `action`: draft — сохранить, schedule — на время `scheduledAt`
 * (публикует cron /api/cron/max-channel), publish — сразу.
 */
export async function POST(request: Request) {
  const session = await requireRoot();
  try {
    const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw) throw new MaxChannelError("Не удалось прочитать запрос.");
    const action = actionSchema.parse(raw.action ?? "draft");
    const draft = maxPostDraftSchema.parse(raw);
    const channel = await db.maxChannel.findUnique({ where: { id: draft.channelId } });
    if (!channel || channel.removed) throw new MaxChannelError("Канал не найден — добавьте бота в канал заново.");
    const scheduledAt = draft.scheduledAt ? new Date(draft.scheduledAt) : null;
    if (action === "schedule") {
      if (!scheduledAt) throw new MaxChannelError("Выберите дату и время публикации.");
      if (scheduledAt.getTime() < Date.now() - 60_000) throw new MaxChannelError("Время публикации уже прошло.");
    }
    const post = await db.maxChannelPost.create({
      data: {
        channelId: channel.id,
        text: draft.text,
        images: draft.images,
        buttonText: draft.buttonText?.trim() || null,
        buttonUrl: draft.buttonUrl?.trim() || null,
        campaign: draft.campaign?.trim() || null,
        status: action === "schedule" ? "scheduled" : "draft",
        scheduledAt: action === "schedule" ? scheduledAt : null,
        createdById: session.user.id,
      },
    });
    if (action === "publish") {
      const result = await publishPost(post.id);
      if (!result.ok) return NextResponse.json({ id: post.id, error: result.error }, { status: 502 });
    }
    return NextResponse.json({ id: post.id });
  } catch (error) {
    return maxChannelFailure(error);
  }
}
