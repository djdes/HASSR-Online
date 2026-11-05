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
const channelIdsSchema = z
  .array(z.string().min(1))
  .min(1, "Выберите, куда публиковать")
  .max(10)
  .transform((ids) => [...new Set(ids)]);

/**
 * POST /api/root/max-channel/posts — новый пост в один или несколько
 * каналов (`channelIds`: Telegram и/или MAX; в каждый — своя запись).
 * `action`: draft — сохранить, schedule — на время `scheduledAt`
 * (публикует cron /api/cron/max-channel), publish — сразу.
 */
export async function POST(request: Request) {
  const session = await requireRoot();
  try {
    const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw) throw new MaxChannelError("Не удалось прочитать запрос.");
    const action = actionSchema.parse(raw.action ?? "draft");
    const channelIds = channelIdsSchema.parse(raw.channelIds ?? (raw.channelId ? [raw.channelId] : []));
    const draft = maxPostDraftSchema.parse({ ...raw, channelId: channelIds[0] });
    const channels = await db.maxChannel.findMany({ where: { id: { in: channelIds }, removed: false } });
    if (channels.length !== channelIds.length) throw new MaxChannelError("Канал не найден — подключите его заново.");
    const scheduledAt = draft.scheduledAt ? new Date(draft.scheduledAt) : null;
    if (action === "schedule") {
      if (!scheduledAt) throw new MaxChannelError("Выберите дату и время публикации.");
      if (scheduledAt.getTime() < Date.now() - 60_000) throw new MaxChannelError("Время публикации уже прошло.");
    }
    const posts = [];
    for (const channel of channels) {
      posts.push(
        await db.maxChannelPost.create({
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
        }),
      );
    }
    if (action === "publish") {
      const failed: string[] = [];
      for (const post of posts) {
        const result = await publishPost(post.id);
        const title = channels.find((channel) => channel.id === post.channelId)?.title ?? "";
        if (!result.ok) failed.push(`«${title}»: ${result.error}`);
      }
      if (failed.length === posts.length) return NextResponse.json({ ids: posts.map((p) => p.id), error: failed.join(" ") }, { status: 502 });
      return NextResponse.json({ ids: posts.map((p) => p.id), published: posts.length - failed.length, failed });
    }
    return NextResponse.json({ ids: posts.map((p) => p.id) });
  } catch (error) {
    return maxChannelFailure(error);
  }
}
