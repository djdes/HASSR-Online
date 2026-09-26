import { advisoryLockKey, withAdvisoryTryLock } from "@/lib/advisory-lock";
import { recordAuditLog, type AuditLogInput } from "@/lib/audit-log";
import { REVIEW_TEXT_MAX_LENGTH, REVIEW_TEXT_MIN_LENGTH } from "@/lib/balance/constants";
import { senderDisplayName } from "@/lib/balance/invite-colleague";
import { ReviewError, submitReview, type ReviewView, type SubmitReviewInput } from "@/lib/balance/reviews";
import { db } from "@/lib/db";
import { NPS_RECOMMEND_AUDIT_ENTITY, NPS_REVIEW_AUDIT_ACTION, normalizeNpsScale, npsInvitesRecommendation } from "@/lib/nps";
import type { NpsRecommendResponseRow } from "@/lib/nps-recommend";

/**
 * «Оставить отзыв» из опроса «Посоветуете WeSetup коллегам?» после оценки 4–5.
 *
 * Тот же отзыв, что в «Баланс и бонусы»: `submitReview` из
 * src/lib/balance/reviews.ts (на проверку ROOT, баллы — только после
 * одобрения, показ на главной — по согласию). Из опроса берутся текст
 * (общее поле с письмом коллеге), оценка ответа (`rating`) и согласие на
 * публикацию. Автор и заведение — как в «Баланс и бонусы»: имя человека и
 * название организации; почту или название организации вместо имени не
 * публикуем — там человек видит подпись и может её поправить, здесь нет.
 *
 * Второй отзыв, пока у организации есть отзыв на проверке, не создаём —
 * говорим об этом. Проверка и создание идут под advisory-замком
 * организации, чтобы двойной клик не прошёл проверку дважды.
 *
 * Связь «ответ → отзыв» — строка AuditLog `nps.review` (сущность
 * NpsResponse, в деталях id отзыва и оценка): по ней /root/nps пишет
 * «оставил отзыв», а модерация — «из опроса». Схему БД не меняем.
 */

export type NpsReviewField = "message" | "consent";

export type NpsReviewAuditDetails = {
  /** Отзыв, созданный из этого ответа. Текст отзыва не дублируем. */
  customerReviewId: string;
  npsScore: number;
};

export type NpsReviewModerationNotice = {
  review: ReviewView;
  organizationName: string;
  npsScore: number;
};

export type NpsReviewDeps = {
  findResponse(id: string): Promise<NpsRecommendResponseRow | null>;
  /** Имя автора и название организации ответа — из базы, а не из сессии. */
  loadSignature(userId: string, organizationId: string): Promise<{ userName: string | null; organizationName: string | null }>;
  withOrganizationLock<T>(organizationId: string, fn: () => Promise<T>): Promise<{ acquired: true; value: T } | { acquired: false }>;
  /** Отзыв организации на проверке, если есть. */
  findPendingReview(organizationId: string): Promise<{ id: string; userId: string } | null>;
  submitReview(input: SubmitReviewInput): Promise<ReviewView>;
  recordAudit(entry: { organizationId: string; responseId: string; details: NpsReviewAuditDetails }): Promise<void>;
  /** Уведомление модератору; ошибки не должны ломать ответ. */
  notifyModerators(notice: NpsReviewModerationNotice): Promise<void>;
};

export type NpsReviewResult =
  | { status: 200; body: { ok: true; reviewId: string } }
  | { status: 400 | 404 | 409 | 429; body: { error: string; field?: NpsReviewField } };

/** Подпись, когда имени нет (или вместо имени — почта / название организации). */
export const NPS_REVIEW_FALLBACK_AUTHOR = "Руководитель";

/** Подпись под отзывом из опроса. */
export function npsReviewAuthorName(userName: string | null | undefined, organizationName: string | null | undefined): string {
  return senderDisplayName(userName, organizationName) ?? NPS_REVIEW_FALLBACK_AUTHOR;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(status: 400 | 404 | 409 | 429, error: string, field?: NpsReviewField): NpsReviewResult {
  return { status, body: field ? { error, field } : { error } };
}

function reviewErrorStatus(status: number): 400 | 404 | 409 {
  return status === 404 || status === 409 ? status : 400;
}

/** Тело `POST /api/nps/review`: `{ responseId, text, consent }`. */
export async function runNpsReview(input: { actor: { id: string }; body: unknown }, deps: NpsReviewDeps): Promise<NpsReviewResult> {
  const body = isRecord(input.body) ? input.body : {};
  const responseId = typeof body.responseId === "string" ? body.responseId.trim() : "";
  if (!responseId || responseId.length > 64) return fail(400, "Сначала поставьте оценку");

  const response = await deps.findResponse(responseId);
  if (!response || response.userId !== input.actor.id) return fail(404, "Ответ не найден — обновите страницу");
  if (!npsInvitesRecommendation(response.score, normalizeNpsScale(response.scale))) {
    return fail(400, "Отзыв из опроса — после оценки 4 или 5");
  }

  const text = typeof body.text === "string" ? body.text.replace(/\r\n?/g, "\n").trim() : "";
  if (text.length < REVIEW_TEXT_MIN_LENGTH) {
    // Поле общее с письмом коллеге — поясняем, что длина нужна именно отзыву.
    return fail(400, `Для отзыва напишите хотя бы пару предложений — от ${REVIEW_TEXT_MIN_LENGTH} символов`, "message");
  }
  if (text.length > REVIEW_TEXT_MAX_LENGTH) return fail(400, `Отзыв — не больше ${REVIEW_TEXT_MAX_LENGTH} символов`, "message");
  if (body.consent !== true) return fail(400, "Без согласия на публикацию отзыв опубликовать нельзя", "consent");

  const organizationId = response.organizationId;
  const signature = await deps.loadSignature(input.actor.id, organizationId);
  const organizationName = (signature.organizationName ?? "").trim();

  const locked = await deps.withOrganizationLock(organizationId, async (): Promise<NpsReviewResult | { review: ReviewView }> => {
    const pending = await deps.findPendingReview(organizationId);
    if (pending) {
      return fail(
        409,
        pending.userId === input.actor.id
          ? "Ваш отзыв уже на проверке — дождитесь решения"
          : "У вашей организации уже есть отзыв на проверке — дождитесь решения",
      );
    }
    try {
      const review = await deps.submitReview({
        organizationId,
        userId: input.actor.id,
        authorName: npsReviewAuthorName(signature.userName, organizationName),
        place: organizationName,
        text,
        rating: response.score,
        consentPublic: true,
        attachment: null,
      });
      await deps.recordAudit({
        organizationId,
        responseId: response.id,
        details: { customerReviewId: review.id, npsScore: response.score },
      });
      return { review };
    } catch (error) {
      if (error instanceof ReviewError) return fail(reviewErrorStatus(error.status), error.message);
      throw error;
    }
  });
  if (!locked.acquired) return fail(429, "Отзыв уже отправляется — подождите пару секунд");
  if (!("review" in locked.value)) return locked.value;

  const { review } = locked.value;
  void deps.notifyModerators({ review, organizationName, npsScore: response.score }).catch(() => undefined);
  return { status: 200, body: { ok: true, reviewId: review.id } };
}

/** id отзыва из деталей строки `nps.review`. */
export function npsReviewIdFromDetails(details: unknown): string | null {
  if (!isRecord(details)) return null;
  const id = details.customerReviewId;
  return typeof id === "string" && id ? id : null;
}

/** Настоящие база и аудит. Уведомление модератору передаёт маршрут. */
export function npsReviewDeps(context: { request?: Request; session?: AuditLogInput["session"] } = {}): Omit<NpsReviewDeps, "notifyModerators"> {
  return {
    findResponse: (id) =>
      db.npsResponse.findUnique({
        where: { id },
        select: { id: true, userId: true, organizationId: true, score: true, scale: true },
      }),
    loadSignature: async (userId, organizationId) => {
      const [user, organization] = await Promise.all([
        db.user.findUnique({ where: { id: userId }, select: { name: true } }),
        db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      ]);
      return { userName: user?.name ?? null, organizationName: organization?.name ?? null };
    },
    withOrganizationLock: (organizationId, fn) =>
      withAdvisoryTryLock(advisoryLockKey("nps-review", organizationId), fn, { attempts: 20, delayMs: 150, timeoutMs: 30_000 }),
    findPendingReview: (organizationId) =>
      db.customerReview.findFirst({
        where: { organizationId, status: "pending" },
        orderBy: { createdAt: "desc" },
        select: { id: true, userId: true },
      }),
    submitReview,
    recordAudit: ({ organizationId, responseId, details }) =>
      recordAuditLog({
        request: context.request,
        session: context.session,
        organizationId,
        action: NPS_REVIEW_AUDIT_ACTION,
        entity: NPS_RECOMMEND_AUDIT_ENTITY,
        entityId: responseId,
        details,
      }),
  };
}

/** Ответы опроса, по которым оставили отзыв, — пометка «оставил отзыв» в /root/nps. */
export async function npsResponsesWithReview(responseIds: string[]): Promise<Set<string>> {
  if (responseIds.length === 0) return new Set();
  const rows = await db.auditLog.findMany({
    where: { entity: NPS_RECOMMEND_AUDIT_ENTITY, action: NPS_REVIEW_AUDIT_ACTION, entityId: { in: responseIds } },
    select: { entityId: true },
  });
  return new Set(rows.map((row) => row.entityId).filter((id): id is string => Boolean(id)));
}

/** Отзывы, оставленные из опроса, — пометка «из опроса» в модерации. */
export async function reviewIdsFromNps(organizationIds: string[]): Promise<Set<string>> {
  if (organizationIds.length === 0) return new Set();
  const rows = await db.auditLog.findMany({
    where: { entity: NPS_RECOMMEND_AUDIT_ENTITY, action: NPS_REVIEW_AUDIT_ACTION, organizationId: { in: organizationIds } },
    select: { details: true },
  });
  const ids = new Set<string>();
  for (const row of rows) {
    const id = npsReviewIdFromDetails(row.details);
    if (id) ids.add(id);
  }
  return ids;
}
