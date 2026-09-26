import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { formatPoints, reviewRewardFor } from "@/lib/balance/constants";
import { npsReviewDeps, runNpsReview, type NpsReviewModerationNotice } from "@/lib/nps-review";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { escapeTelegramHtml } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** То же уведомление, что у формы «Баланс и бонусы», с пометкой «из опроса». */
async function notifyModerators({ review, organizationName, npsScore }: NpsReviewModerationNotice): Promise<void> {
  await notifyPlatformAdmin(
    [
      "⭐ Новый отзыв на модерации — из опроса «Посоветуете WeSetup коллегам?»",
      `Организация: ${escapeTelegramHtml(organizationName || "—")}`,
      `Автор: ${escapeTelegramHtml(review.authorName)} · ${escapeTelegramHtml(review.place)}`,
      `Оценка в опросе: ${npsScore} из 5`,
      `Вид: ${review.kind} · к начислению ${formatPoints(reviewRewardFor(review.kind))}`,
      "",
      escapeTelegramHtml(review.text.slice(0, 500)),
      "",
      "Модерация: /root/reviews",
    ].join("\n"),
    { kind: "review", dedupeKey: `review:${review.id}` },
  ).catch((error) => console.error("[nps] уведомление об отзыве не ушло", error));
}

/**
 * POST { responseId, text, consent } — «Оставить отзыв» после оценки 4–5
 * в опросе «Посоветуете WeSetup коллегам?». Отзыв — тот же, что в
 * «Баланс и бонусы» (`submitReview`): на проверку ROOT, баллы — после
 * одобрения, на главной — по согласию. Пока у организации есть отзыв на
 * проверке, второй не создаётся (409). Связь с ответом — AuditLog `nps.review`.
 */
export async function POST(request: Request) {
  const session = await requireAuth();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  try {
    const result = await runNpsReview(
      { actor: { id: session.user.id }, body },
      { ...npsReviewDeps({ request, session }), notifyModerators },
    );
    if (result.status === 200) {
      console.info(`[nps] отзыв из опроса: user=${session.user.id} review=${result.body.reviewId}`);
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error(`[nps] отзыв из опроса не сохранился: user=${session.user.id}`, error);
    return NextResponse.json({ error: "Не удалось отправить отзыв" }, { status: 500 });
  }
}
