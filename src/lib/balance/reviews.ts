import { db } from "@/lib/db";

import { isReviewKind, reviewRewardFor, type ReviewKind } from "./constants";
import { buildReviewSubmission, publicReviewSignature, reviewSphereLabel } from "./review-rules";
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
 *
 * Анонимный отзыв (флаг `anonymous` в БД) публикуется без имени и
 * заведения и стоит на 20 % меньше — сумму считает одобрение по флагу из
 * базы, клиент её не присылает.
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
  anonymous: boolean;
  status: string;
  rewardRub: number;
  rejectReason: string | null;
  showOnLanding: boolean;
  createdAt: Date;
  moderatedAt: Date | null;
};

type OrganizationLabel = { name: string; type: string | null };

function toView(row: ReviewRow, organization: OrganizationLabel): ReviewView {
  const kind: ReviewKind = isReviewKind(row.kind) ? row.kind : "text";
  const anonymous = row.anonymous === true;
  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationName: organization.name,
    userId: row.userId,
    authorName: row.authorName,
    place: row.place,
    text: row.text,
    kind,
    mediaUrl: row.mediaUrl,
    mediaMime: row.mediaMime,
    rating: row.rating,
    consentPublic: row.consentPublic,
    anonymous,
    organizationSphere: reviewSphereLabel(organization.type),
    status: (["pending", "approved", "rejected"] as string[]).includes(row.status)
      ? (row.status as ReviewStatus)
      : "pending",
    rewardRub: row.rewardRub,
    suggestedRewardRub: reviewRewardFor(kind, anonymous),
    rejectReason: row.rejectReason,
    showOnLanding: row.showOnLanding,
    createdAt: row.createdAt.toISOString(),
    moderatedAt: row.moderatedAt?.toISOString() ?? null,
  };
}

const UNKNOWN_ORGANIZATION: OrganizationLabel = { name: "—", type: null };

async function organizationLabel(organizationId: string): Promise<OrganizationLabel> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, type: true },
  });
  return org ?? UNKNOWN_ORGANIZATION;
}

async function organizationLabels(ids: string[]): Promise<Map<string, OrganizationLabel>> {
  if (ids.length === 0) return new Map();
  const orgs = await db.organization.findMany({
    where: { id: { in: Array.from(new Set(ids)) } },
    select: { id: true, name: true, type: true },
  });
  return new Map(orgs.map((o) => [o.id, { name: o.name, type: o.type }]));
}

export type SubmitReviewInput = {
  organizationId: string;
  userId: string;
  /** Для анонимного отзыва не нужны и не сохраняются. */
  authorName: string;
  place: string;
  /** Анонимный отзыв: без имени и заведения, начисление × ANONYMOUS_REVIEW_FACTOR. */
  anonymous?: boolean;
  text: string;
  rating: number | null;
  consentPublic: boolean;
  attachment: { url: string; mimeType: string } | null;
};

/** Новый отзыв «на проверке». Один активный отзыв на пользователя. */
export async function submitReview(input: SubmitReviewInput): Promise<ReviewView> {
  // Проверки, вид по вложению и анонимность — чистой функцией
  // (review-rules.ts); сумма в отзыв не пишется — её считает одобрение.
  const built = buildReviewSubmission({
    text: input.text,
    authorName: input.authorName,
    place: input.place,
    anonymous: input.anonymous === true,
    consentPublic: input.consentPublic,
    rating: input.rating,
    attachmentMime: input.attachment?.mimeType ?? null,
  });
  if (!built.ok) throw new ReviewError(built.error);
  const { text, authorName, place, kind, rating, anonymous } = built.value;

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
      rating,
      consentPublic: true,
      anonymous,
    },
  });
  console.info(
    `[balance] review submitted id=${created.id} org=${input.organizationId} user=${input.userId} kind=${kind} anonymous=${anonymous} reward=${reviewRewardFor(kind, anonymous)}`,
  );
  return toView(created, await organizationLabel(input.organizationId));
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
}): Promise<{ rewardRub: number; organizationId: string; anonymous: boolean; kind: ReviewKind } | null> {
  const review = await db.customerReview.findUnique({
    where: { id: input.id },
    select: { id: true, organizationId: true, kind: true, status: true, anonymous: true },
  });
  if (!review) throw new ReviewError("Отзыв не найден", 404);
  if (review.status !== "pending") return null;

  const storedKind: ReviewKind = isReviewKind(review.kind) ? review.kind : "text";
  const kind = input.kind ?? storedKind;
  // Анонимность — из БД: какой бы тариф ни выбрал модератор, анонимный
  // отзыв стоит × ANONYMOUS_REVIEW_FACTOR.
  const rewardRub = reviewRewardFor(kind, review.anonymous);

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
        description: review.anonymous ? "Анонимный отзыв о WeSetup принят" : "Отзыв о WeSetup принят",
        dedupeKey: `review_reward:${review.id}`,
        customerReviewId: review.id,
        actorUserId: input.actorUserId,
      });
      console.info(
        `[balance] review approved id=${review.id} org=${review.organizationId} kind=${kind} anonymous=${review.anonymous} reward=${rewardRub} by=${input.actorUserId}`,
      );
      return { rewardRub, organizationId: review.organizationId, anonymous: review.anonymous, kind };
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
  if (claimed.count > 0) {
    console.info(`[balance] review rejected id=${input.id} by=${input.actorUserId}`);
  }
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
  return toView(row, await organizationLabel(row.organizationId));
}

/** Отзыв текущего пользователя — карточка статуса в кабинете. */
export async function getMyReview(userId: string): Promise<ReviewView | null> {
  const row = await db.customerReview.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return toView(row, await organizationLabel(row.organizationId));
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
  const labels = await organizationLabels(rows.map((r) => r.organizationId));
  return rows.map((row) => toView(row, labels.get(row.organizationId) ?? UNKNOWN_ORGANIZATION));
}

/**
 * Одобренные отзывы для лендинга. Согласие на публикацию обязательно.
 * Анонимный — без имени и заведения: «Анонимный отзыв» и сфера
 * организации, если она известна (publicReviewSignature).
 */
export async function listPublicReviews(limit = 12): Promise<PublicReview[]> {
  const rows = await db.customerReview.findMany({
    where: { status: "approved", showOnLanding: true, consentPublic: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const labels = await organizationLabels(
    rows.filter((row) => row.anonymous).map((row) => row.organizationId),
  );
  return rows.map((row) => {
    const signature = publicReviewSignature({
      anonymous: row.anonymous,
      authorName: row.authorName,
      place: row.place,
      sphere: row.anonymous ? reviewSphereLabel(labels.get(row.organizationId)?.type ?? null) : null,
    });
    return {
      id: row.id,
      quote: row.text,
      author: signature.author,
      place: signature.place,
      rating: row.rating,
      mediaUrl: row.mediaUrl,
      mediaKind: row.kind === "photo" ? "photo" : row.kind === "video" ? "video" : null,
      anonymous: row.anonymous,
    };
  });
}
