import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { maxPostDraftSchema } from "@/lib/max/channel-post";
import { MaxChannelError, deletePublishedPost, editPublishedPost } from "@/lib/max/channel.server";
import { maxChannelFailure } from "@/lib/max/channel-api.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH — правка поста. Черновик/запланированный/с ошибкой меняется в
 * базе (с `scheduledAt` — переносится, без него — становится черновиком);
 * опубликованный правится прямо в канале.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await ctx.params;
  try {
    const post = await db.maxChannelPost.findUnique({ where: { id } });
    if (!post) throw new MaxChannelError("Пост не найден.", 404);
    if (post.status === "sending") throw new MaxChannelError("Пост сейчас отправляется — подождите минуту.", 409);
    if (post.status === "deleted") throw new MaxChannelError("Пост удалён из канала — создайте новый.", 409);
    const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw) throw new MaxChannelError("Не удалось прочитать запрос.");
    const draft = maxPostDraftSchema.parse({ ...raw, channelId: post.channelId });
    const fields = {
      text: draft.text,
      images: draft.images,
      buttonText: draft.buttonText?.trim() || null,
      buttonUrl: draft.buttonUrl?.trim() || null,
      campaign: draft.campaign?.trim() || null,
    };
    if (post.status === "sent") {
      // Сначала в канал, потом в базу: история должна совпадать с каналом.
      const previous = await db.maxChannelPost.update({ where: { id }, data: fields });
      try {
        await editPublishedPost(id);
      } catch (error) {
        await db.maxChannelPost.update({
          where: { id },
          data: { text: post.text, images: post.images, buttonText: post.buttonText, buttonUrl: post.buttonUrl, campaign: post.campaign },
        });
        throw error;
      }
      return NextResponse.json({ id: previous.id, edited: true });
    }
    const scheduledAt = draft.scheduledAt ? new Date(draft.scheduledAt) : null;
    if (scheduledAt && scheduledAt.getTime() < Date.now() - 60_000) throw new MaxChannelError("Время публикации уже прошло.");
    await db.maxChannelPost.update({
      where: { id },
      data: { ...fields, status: scheduledAt ? "scheduled" : "draft", scheduledAt, error: null },
    });
    return NextResponse.json({ id });
  } catch (error) {
    return maxChannelFailure(error);
  }
}

/** DELETE — опубликованный удаляется из канала, остальные — из списка. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await ctx.params;
  try {
    const post = await db.maxChannelPost.findUnique({ where: { id } });
    if (!post) throw new MaxChannelError("Пост не найден.", 404);
    if (post.status === "sending") throw new MaxChannelError("Пост сейчас отправляется — подождите минуту.", 409);
    if (post.status === "sent") {
      await deletePublishedPost(id);
      return NextResponse.json({ removedFromChannel: true });
    }
    await db.maxChannelPost.delete({ where: { id } });
    return NextResponse.json({ removedFromChannel: false });
  } catch (error) {
    return maxChannelFailure(error);
  }
}
