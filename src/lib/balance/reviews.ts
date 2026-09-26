import { db } from "@/lib/db";

import {
  REVIEW_TEXT_MAX_LENGTH,
  REVIEW_TEXT_MIN_LENGTH,
  isReviewKind,
  reviewKindFromMime,
  reviewRewardFor,
  type ReviewKind,
} from "./constants";
import {
  reviewSocialText,
  type PublicReview,
  type ReviewStatus,
  type ReviewView,
} from "./review-view";
import { applyBalanceChange, DuplicateBalanceChangeError } from "./ledger";

export { reviewSocialText };
export type { PublicReview, ReviewStatus, ReviewView };

/**
 * Отзывы клиентов за баллы.
 *
 * Тариф считается по вложению (нет — 300, фото — 750, видео — 1990), но
 * начисление происходит ТОЛЬКО после одобрения ROOT'ом: иначе достаточно
 * было бы загрузить любое видео и получить 1990 ₽. ROOT при одобрении
 * может понизить тариф (например, видео на три секунды — как текст).
 */

export class ReviewError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ReviewError";
    this.status = status;
  }
}

type ReviewRow = {
  id: string;
  organizationId: string;
  userId: string;
  authorName: string;
  place: string;
  text: string;
  kind: string;
  mediaUrl: string | null;
  mediaMime: string | null;
  rating: number | null;
  consentPublic: boolean;
  status: string;
  rewardRub: number;
  rejectReason: string | null;
  showOnLanding: boolean;
  createdAt: Date;
  moderatedAt: Date | null;
};

function toView(row: ReviewRow, organizationName: string): ReviewView {
  const kind: ReviewKind = isReviewKind(row.kind) ? row.kind : "text";
  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationName,
    userId: row.userId,
    authorName: row.authorName,
    place: row.place,
    text: row.text,
    kind,
    mediaUrl: row.mediaUrl,
    mediaMime: row.mediaMime,
    rating: row.rating,
    consentPublic: row.consentPublic,
    status: (["pending", "approved", "rejected"] as string[]).includes(row.status)
      ? (row.status as ReviewStatus)
      : "pending",
    rewardRub: row.rewardRub,
    suggestedRewardRub: reviewRewardFor(kind),
    rejectReason: row.rejectReason,
    showOnLanding: row.showOnLanding,
    createdAt: row.createdAt.toISOString(),
    moderatedAt: row.moderatedAt?.toISOString() ?? null,
  };
}

export type SubmitReviewInput = {
  organizationId: string;
  userId: string;
  authorName: string;
  place: string;
  text: string;
  rating: number | null;
  consentPublic: boolean;
  attachment: { url: string; mimeType: string } | null;
};

/** Новый отзыв «на проверке». Один активный отзыв на пользователя. */
export async function submitReview(input: SubmitReviewInput): Promise<ReviewView> {
  const text = input.text.trim();
  if (text.length < REVIEW_TEXT_MIN_LENGTH) {
    throw new ReviewError(`Напишите хотя бы пару предложений — от ${REVIEW_TEXT_MIN_LENGTH} символов`);
  }
  if (text.length > REVIEW_TEXT_MAX_LENGTH) {
    throw new ReviewError(`Не больше ${REVIEW_TEXT_MAX_LENGTH} символов`);
  }
  const authorName = input.authorName.trim().slice(0, 120);
  const place = input.place.trim().slice(0, 160);
  if (!authorName) throw new ReviewError("Укажите, как вас подписать");
  if (!place) throw new ReviewError("Укажите заведение и город");

  const kind = reviewKindFromMime(input.attachment?.mimeType ?? null);
  if (!kind) {
    throw new ReviewError(
      "Такой файл не подойдёт. Фото — JPG, PNG, WEBP или GIF, видео — MP4 или MOV",
    );
  }

  const active = await db.customerReview.findFirst({
    where: { userId: input.userId, status: { in: ["pending", "approved"] } },
    select: { id: true, status: true },
  });
  if (active) {
    throw new ReviewError(
      active.status === "pending"
        ? "Ваш отзыв уже на проверке — дождитесь решения"
        : "Отзыв уже принят. Спасибо!",
      409,
    );
  }

  const created = await db.customerReview.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      authorName,
      place,
      text,
      kind,
      mediaUrl: input.attachment?.url ?? null,
      mediaMime: input.attachment?.mimeType ?? null,
      rating:
        input.rating && input.rating >= 1 && input.rating <= 5
          ? Math.round(input.rating)
          : null,
      consentPublic: input.consentPublic,
    },
  });
  const org = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: { name: true },
  });
  return toView(created, org?.name ?? "—");
}

/**
 * Одобрение: атомарно забираем отзыв из `pending` и в той же транзакции
 * начисляем баллы. Повторное одобрение получит count = 0 и станет no-op.
 */
export async function approveReview(input: {
  id: string;
  /** Понижение тарифа модератором. Не задан — тариф по вложению. */
  kind?: ReviewKind | null;
  actorUserId: string;
}): Promise<{ rewardRub: number; organizationId: string } | null> {
  const review = await db.customerReview.findUnique({
    where: { id: input.id },
    select: { id: true, organizationId: true, kind: true, status: true },
  });
  if (!review) throw new ReviewError("Отзыв не найден", 404);
  if (review.status !== "pending") return null;

  const storedKind: ReviewKind = isReviewKind(review.kind) ? review.kind : "text";
  const kind = input.kind ?? storedKind;
  const rewardRub = reviewRewardFor(kind);

  try {
    return await db.$transaction(async (tx) => {
      const claimed = await tx.customerReview.updateMany({
        where: { id: input.id, status: "pending" },
        data: {
          status: "approved",
          rewardRub,
          kind,
          moderatedAt: new Date(),
          moderatedByUserId: input.actorUserId,
          rejectReason: null,
        },
      });
      if (claimed.count === 0) return null;

      await applyBalanceChange(tx, {
        organizationId: review.organizationId,
        amount: rewardRub,
        kind: "review_reward",
        description: "Отзыв о WeSetup принят",
        dedupeKey: `review_reward:${review.id}`,
        customerReviewId: review.id,
        actorUserId: input.actorUserId,
      });
      return { rewardRub, organizationId: review.organizationId };
    });
  } catch (error) {
    if (error instanceof DuplicateBalanceChangeError) return null;
    throw error;
  }
}

export async function rejectReview(input: {
  id: string;
  reason: string;
  actorUserId: string;
}): Promise<boolean> {
  const reason = input.reason.trim().slice(0, 500);
  if (!reason) throw new ReviewError("Укажите причину — автор её увидит");
  const claimed = await db.customerReview.updateMany({
    where: { id: input.id, status: "pending" },
    data: {
      status: "rejected",
      rejectReason: reason,
      moderatedAt: new Date(),
      moderatedByUserId: input.actorUserId,
    },
  });
  return claimed.count > 0;
}

export async function setReviewOnLanding(id: string, show: boolean): Promise<void> {
  await db.customerReview.update({
    where: { id },
    data: { showOnLanding: show },
  });
}

export async function getReview(id: string): Promise<ReviewView | null> {
  const row = await db.customerReview.findUnique({ where: { id } });
  if (!row) return null;
  const org = await db.organization.findUnique({
    where: { id: row.organizationId },
    select: { name: true },
  });
  return toView(row, org?.name ?? "—");
}

/** Отзыв текущего пользователя — карточка статуса в кабинете. */
export async function getMyReview(userId: string): Promise<ReviewView | null> {
  const row = await db.customerReview.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  const org = await db.organization.findUnique({
    where: { id: row.organizationId },
    select: { name: true },
  });
  return toView(row, org?.name ?? "—");
}

export async function listReviewsForModeration(
  status: ReviewStatus,
): Promise<ReviewView[]> {
  const rows = await db.customerReview.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  if (rows.length === 0) return [];
  const orgs = await db.organization.findMany({
    where: { id: { in: Array.from(new Set(rows.map((r) => r.organizationId))) } },
    select: { id: true, name: true },
  });
  const names = new Map(orgs.map((o) => [o.id, o.name]));
  return rows.map((row) => toView(row, names.get(row.organizationId) ?? "—"));
}

/** Одобренные отзывы для лендинга. Согласие на публикацию обязательно. */
export async function listPublicReviews(limit = 12): Promise<PublicReview[]> {
  const rows = await db.customerReview.findMany({
    where: { status: "approved", showOnLanding: true, consentPublic: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    quote: row.text,
    author: row.authorName,
    place: row.place,
    rating: row.rating,
    mediaUrl: row.mediaUrl,
    mediaKind:
      row.kind === "photo" ? "photo" : row.kind === "video" ? "video" : null,
  }));
}
