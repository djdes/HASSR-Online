import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { escapeTelegramHtml, notifyOrganization } from "@/lib/telegram";
import { getReview, rejectReview, ReviewError } from "@/lib/balance/reviews";
import { sendReviewModeratedEmail } from "@/lib/balance/emails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/root/reviews/<id>/reject — отклонить отзыв с причиной.
 *
 * Причина обязательна и уходит автору: «не подошло» без объяснения — это
 * тупик, после которого человек второй раз писать не станет.
 */
const bodySchema = z.object({
  reason: z.string().trim().min(3, "Укажите причину").max(500),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRoot();
  const { id } = await ctx.params;

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Некорректные данные" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Не удалось прочитать запрос" }, { status: 400 });
  }

  const review = await getReview(id);
  if (!review) {
    return NextResponse.json({ error: "Отзыв не найден" }, { status: 404 });
  }

  try {
    const rejected = await rejectReview({
      id,
      reason: parsed.reason,
      actorUserId: session.user.id,
    });
    if (!rejected) {
      return NextResponse.json({ ok: true, alreadyModerated: true });
    }
  } catch (error) {
    if (error instanceof ReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  await recordAuditLog({
    request,
    session,
    organizationId: review.organizationId,
    action: "review.reject",
    entity: "CustomerReview",
    entityId: review.id,
    details: { reason: parsed.reason, kind: review.kind, anonymous: review.anonymous },
  });

  notifyOrganization(
    review.organizationId,
    `${review.anonymous ? "Анонимный отзыв" : `Отзыв ${escapeTelegramHtml(review.authorName)}`} не опубликован: ${escapeTelegramHtml(
      parsed.reason,
    )}. Можно поправить и отправить заново в разделе «Баланс и бонусы».`,
  ).catch((error) => console.error("review reject notify failed", error));

  const author = await db.user.findUnique({
    where: { id: review.userId },
    select: { email: true },
  });
  if (author?.email && !author.email.endsWith("@invite.local")) {
    sendReviewModeratedEmail({
      to: author.email,
      approved: false,
      rewardRub: 0,
      rejectReason: parsed.reason,
    }).catch((error) => console.error("sendReviewModeratedEmail failed", error));
  }

  return NextResponse.json({ ok: true });
}
