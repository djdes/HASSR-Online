import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { maxChannelFailure } from "@/lib/max/channel-api.server";
import { MaxChannelError } from "@/lib/max/channel.server";
import { assertQualityGate, newShortCode, qualityFor } from "@/lib/smm/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  /** A24: утвердить или вернуть на доработку. */
  z.object({ action: z.literal("approve"), force: z.boolean().optional() }),
  z.object({ action: z.literal("reject"), comment: z.string().trim().max(500).optional() }),
  /** A15/A19: копия поста; repeatWeeks > 0 — повтор каждую неделю N раз. */
  z.object({ action: z.literal("duplicate"), repeatWeeks: z.number().int().min(0).max(12).default(0) }),
  /** A25: вернуть версию текста из истории (для неопубликованных). */
  z.object({ action: z.literal("restore"), versionId: z.string().min(1) }),
]);

/** POST /api/root/max-channel/posts/<id>/actions — согласование, копии, откат версии. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  try {
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const post = await db.maxChannelPost.findUnique({ where: { id } });
    if (!post) throw new MaxChannelError("Пост не найден.", 404);

    if (body.action === "approve" || body.action === "reject") {
      if (post.status !== "review") throw new MaxChannelError("Пост не ждёт согласования.", 409);
      if (body.action === "reject") {
        await db.maxChannelPost.update({
          where: { id },
          data: { status: "draft", approval: "none", error: body.comment ? `Вернули на доработку: ${body.comment}` : "Вернули на доработку" },
        });
        return NextResponse.json({ ok: true });
      }
      const report = await qualityFor({ ...post, channelIds: [post.channelId], excludeIds: [id] });
      assertQualityGate(report, Boolean(body.force));
      const future = post.scheduledAt && post.scheduledAt.getTime() > Date.now();
      await db.maxChannelPost.update({
        where: { id },
        data: {
          status: future ? "scheduled" : "draft",
          approval: "approved",
          approvedById: session.user.id,
          qualityScore: report.score,
          qualityVerdict: report.verdict,
        },
      });
      return NextResponse.json({ ok: true, scheduled: Boolean(future) });
    }

    if (body.action === "duplicate") {
      const copies = Math.max(1, body.repeatWeeks);
      const ids: string[] = [];
      for (let i = 1; i <= copies; i += 1) {
        const base = post.scheduledAt ?? post.sentAt;
        const scheduledAt = body.repeatWeeks && base ? new Date(base.getTime() + i * 7 * 86_400_000) : null;
        const copy = await db.maxChannelPost.create({
          data: {
            channelId: post.channelId,
            text: post.text,
            images: post.images,
            buttonText: post.buttonText,
            buttonUrl: post.buttonUrl,
            campaign: post.campaign,
            rubric: post.rubric,
            silent: post.silent,
            pin: post.pin,
            disablePreview: post.disablePreview,
            protect: post.protect,
            shortCode: post.buttonUrl ? newShortCode() : null,
            status: scheduledAt && scheduledAt.getTime() > Date.now() ? "scheduled" : "draft",
            scheduledAt: scheduledAt && scheduledAt.getTime() > Date.now() ? scheduledAt : null,
            createdById: session.user.id,
          },
        });
        ids.push(copy.id);
      }
      return NextResponse.json({ ids });
    }

    const version = await db.maxChannelPostVersion.findFirst({ where: { id: body.versionId, postId: id } });
    if (!version) throw new MaxChannelError("Версия не найдена.", 404);
    if (post.status === "sent" || post.status === "sending") {
      throw new MaxChannelError("У вышедшего поста откройте правку и вставьте текст версии — так он сразу поменяется в канале.", 409);
    }
    await db.maxChannelPostVersion.create({
      data: { postId: id, text: post.text, buttonText: post.buttonText, buttonUrl: post.buttonUrl, editedById: session.user.id },
    });
    await db.maxChannelPost.update({
      where: { id },
      data: { text: version.text, buttonText: version.buttonText, buttonUrl: version.buttonUrl },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return maxChannelFailure(error);
  }
}

/** GET — история версий текста (A25). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await ctx.params;
  const versions = await db.maxChannelPostVersion.findMany({
    where: { postId: id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, text: true, buttonText: true, buttonUrl: true, createdAt: true },
  });
  return NextResponse.json({ versions });
}
