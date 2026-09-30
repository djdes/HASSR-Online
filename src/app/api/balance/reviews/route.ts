import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { escapeTelegramHtml } from "@/lib/telegram";
import { validateSignedAttachments } from "@/lib/support-attachments";
import {
  REVIEW_TEXT_MAX_LENGTH,
  formatPoints,
  reviewKindFromMime,
  reviewRewardFor,
} from "@/lib/balance/constants";
import { ReviewError, submitReview } from "@/lib/balance/reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/balance/reviews — отзыв клиента за баллы.
 *
 * Вложение приезжает подписанными метами того же загрузчика, что и в
 * поддержке (`/api/support/attachments`): прицепить чужой или выдуманный
 * файл нельзя. Тариф определяется по MIME, но начисление происходит
 * только после одобрения ROOT'ом.
 */
const reviewSchema = z.object({
  text: z
    .string()
    .trim()
    .min(30, "Напишите хотя бы пару предложений — от 30 символов")
    .max(REVIEW_TEXT_MAX_LENGTH, "Слишком длинный отзыв"),
  // Имя и заведение обязательны только у обычного отзыва — это проверяет
  // buildReviewSubmission (review-rules.ts); у анонимного они не хранятся.
  authorName: z.string().max(120).optional(),
  place: z.string().max(160).optional(),
  anonymous: z.boolean().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  consentPublic: z.boolean(),
  attachments: z.unknown().optional(),
  // Суммы и вида в схеме нет намеренно: zod их отбросит, начисление
  // считает одобрение по вложению и флагу anonymous из БД.
});

export async function POST(request: Request) {
  const session = await requireAuth();
  const organizationId = getActiveOrgId(session);

  let parsed: z.infer<typeof reviewSchema>;
  try {
    parsed = reviewSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Некорректные данные" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Не удалось прочитать запрос" },
      { status: 400 },
    );
  }

  if (!parsed.consentPublic) {
    return NextResponse.json(
      { error: "Без согласия на публикацию отзыв опубликовать нельзя" },
      { status: 400 },
    );
  }

  const attachments = validateSignedAttachments(
    parsed.attachments,
    session.user.id,
  );
  if (attachments === null) {
    return NextResponse.json(
      { error: "Вложение не прошло проверку — прикрепите файл заново" },
      { status: 400 },
    );
  }
  if (attachments.length > 1) {
    return NextResponse.json(
      { error: "К отзыву можно приложить один файл" },
      { status: 400 },
    );
  }
  const attachment = attachments[0] ?? null;
  if (attachment && !reviewKindFromMime(attachment.mimeType)) {
    return NextResponse.json(
      {
        error:
          "Такой файл не подойдёт. Фото — JPG, PNG, WEBP или GIF, видео — MP4 или MOV",
      },
      { status: 400 },
    );
  }

  try {
    const review = await submitReview({
      organizationId,
      userId: session.user.id,
      authorName: parsed.authorName ?? "",
      place: parsed.place ?? "",
      anonymous: parsed.anonymous === true,
      text: parsed.text,
      rating: parsed.rating ?? null,
      consentPublic: parsed.consentPublic,
      attachment: attachment
        ? { url: attachment.url, mimeType: attachment.mimeType }
        : null,
    });

    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    notifyPlatformAdmin(
      [
        "⭐ Новый отзыв на модерации",
        `Организация: ${escapeTelegramHtml(organization?.name ?? "—")}`,
        review.anonymous
          ? "Автор: анонимно (без имени и заведения на сайте)"
          : `Автор: ${escapeTelegramHtml(review.authorName)} · ${escapeTelegramHtml(review.place)}`,
        `Вид: ${review.kind}${review.anonymous ? " · анонимно −20 %" : ""} · к начислению ${formatPoints(reviewRewardFor(review.kind, review.anonymous))}`,
        "",
        escapeTelegramHtml(review.text.slice(0, 500)),
        "",
        "Модерация: /root/reviews",
      ].join("\n"),
      { kind: "review", dedupeKey: `review:${review.id}` },
    ).catch((error) => console.error("review admin notify failed", error));

    return NextResponse.json({ ok: true, review });
  } catch (error) {
    if (error instanceof ReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("submitReview failed", error);
    return NextResponse.json(
      { error: "Не удалось отправить отзыв" },
      { status: 500 },
    );
  }
}
