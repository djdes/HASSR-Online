import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { escapeTelegramHtml, notifyOrganization } from "@/lib/telegram";
import { formatPoints, isReviewKind } from "@/lib/balance/constants";
import { approveReview, getReview, ReviewError } from "@/lib/balance/reviews";
import { sendReviewModeratedEmail } from "@/lib/balance/emails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/root/reviews/<id>/approve — одобрить отзыв и начислить баллы.
 *
 * Тариф по умолчанию считается по вложению, но модератор может понизить:
 * трёхсекундное видео «для галочки» — это отзыв уровня текста.
 * Повторное одобрение — no-op, а не вторая выплата.
 */
const bodySchema = z.object({
  kind: z.string().optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRoot();
  const { id } = await ctx.params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const kind =
    parsed.success && isReviewKind(parsed.data.kind) ? parsed.data.kind : null;

  try {
    const result = await approveReview({
      id,
      kind,
      actorUserId: session.user.id,
    });
    if (!result) {
      return NextResponse.json(
        { ok: true, alreadyModerated: true },
        { status: 200 },
      );
    }

    await recordAuditLog({
      request,
      session,
      organizationId: result.organizationId,
      action: "review.approve",
      entity: "CustomerReview",
      entityId: id,
      details: { rewardRub: result.rewardRub, kind: result.kind, anonymous: result.anonymous },
    });

    const review = await getReview(id);
    if (review) {
      notifyOrganization(
        result.organizationId,
        `⭐ ${review.anonymous ? "Анонимный отзыв" : `Отзыв ${escapeTelegramHtml(review.authorName)}`} опубликован — на баланс организации начислено <b>${formatPoints(
          result.rewardRub,
        )}</b>. Баллы спишутся при следующей оплате подписки.`,
      ).catch((error) => console.error("review approve notify failed", error));

      const author = await db.user.findUnique({
        where: { id: review.userId },
        select: { email: true },
      });
      if (author?.email && !author.email.endsWith("@invite.local")) {
        sendReviewModeratedEmail({
          to: author.email,
          approved: true,
          rewardRub: result.rewardRub,
        }).catch((error) =>
          console.error("sendReviewModeratedEmail failed", error),
        );
      }
    }

    return NextResponse.json({ ok: true, rewardRub: result.rewardRub });
  } catch (error) {
    if (error instanceof ReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("approveReview failed", error);
    return NextResponse.json({ error: "Не удалось одобрить" }, { status: 500 });
  }
}
