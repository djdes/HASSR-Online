import { db } from "@/lib/db";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { platformOrgId } from "@/lib/partners/partner-hint";
import { SUPPORT_EMAIL } from "@/lib/support-chat-bus";
import { getDbRoleValuesWithLegacy, MANAGEMENT_ROLES, pickPrimaryManager } from "@/lib/user-roles";

import {
  REVIEW_REQUEST_ACTION,
  REVIEW_REQUEST_COOLDOWN_DAYS,
  REVIEW_REQUEST_MIN_AGE_DAYS,
  REVIEW_REQUEST_MIN_RECORDS,
  composeReviewRequestEmail,
  pickReviewCandidates,
  type ReviewCandidate,
  type ReviewCandidateInput,
} from "./review-requests";

const DAY_MS = 86_400_000;

export class ReviewRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Данные для отбора: организации старше 21 дня (не демо, не платформа),
 * записи за 30 дней (`JournalEntry` + `JournalDocumentEntry` без пустых
 * автосозданных строк), отзыв на проверке или одобренный, когда просили
 * (журнал действий платформы), последний ответ на опрос, главный
 * руководитель с почтой. `organizationId` — только одна организация.
 */
async function loadCandidateInputs(now: Date, organizationId?: string): Promise<ReviewCandidateInput[]> {
  const activeFrom = new Date(now.getTime() - 30 * DAY_MS);
  const platform = platformOrgId();
  const orgs = await db.organization.findMany({
    where: {
      isDemo: false,
      id: organizationId ? { equals: organizationId, not: platform } : { not: platform },
      ...(organizationId ? {} : { createdAt: { lte: new Date(now.getTime() - REVIEW_REQUEST_MIN_AGE_DAYS * DAY_MS) } }),
    },
    select: { id: true, name: true, createdAt: true },
  });
  if (orgs.length === 0) return [];
  const ids = orgs.map((org) => org.id);

  const [entryCounts, documentEntryCounts, reviews, requests, answers, managers] = await Promise.all([
    db.journalEntry.groupBy({ by: ["organizationId"], _count: { _all: true }, where: { organizationId: { in: ids }, createdAt: { gte: activeFrom } } }),
    db.journalDocumentEntry.groupBy({
      by: ["documentId"],
      _count: { _all: true },
      where: { ...NOT_AUTO_SEEDED, createdAt: { gte: activeFrom }, document: { organizationId: { in: ids } } },
    }),
    db.customerReview.findMany({ where: { organizationId: { in: ids }, status: { in: ["pending", "approved"] } }, select: { organizationId: true } }),
    db.auditLog.findMany({
      where: {
        organizationId: platform,
        action: REVIEW_REQUEST_ACTION,
        entity: "Organization",
        entityId: { in: ids },
        createdAt: { gte: new Date(now.getTime() - REVIEW_REQUEST_COOLDOWN_DAYS * DAY_MS) },
      },
      select: { entityId: true, createdAt: true },
    }),
    db.npsResponse.findMany({ where: { organizationId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { organizationId: true, score: true, scale: true } }),
    db.user.findMany({
      where: { organizationId: { in: ids }, isActive: true, archivedAt: null, role: { in: getDbRoleValuesWithLegacy(MANAGEMENT_ROLES) } },
      select: { organizationId: true, name: true, email: true, role: true },
    }),
  ]);

  const documents = documentEntryCounts.length
    ? await db.journalDocument.findMany({ where: { id: { in: documentEntryCounts.map((row) => row.documentId) } }, select: { id: true, organizationId: true } })
    : [];
  const documentOrg = new Map(documents.map((document) => [document.id, document.organizationId]));

  const records = new Map<string, number>();
  for (const row of entryCounts) records.set(row.organizationId, (records.get(row.organizationId) ?? 0) + row._count._all);
  for (const row of documentEntryCounts) {
    const orgId = documentOrg.get(row.documentId);
    if (orgId) records.set(orgId, (records.get(orgId) ?? 0) + row._count._all);
  }
  const withReview = new Set(reviews.map((row) => row.organizationId));
  const requestedAt = new Map<string, Date>();
  for (const row of requests) {
    if (!row.entityId) continue;
    const known = requestedAt.get(row.entityId);
    if (!known || row.createdAt > known) requestedAt.set(row.entityId, row.createdAt);
  }
  const lastNps = new Map<string, { score: number; scale: number }>();
  for (const row of answers) if (!lastNps.has(row.organizationId)) lastNps.set(row.organizationId, { score: row.score, scale: row.scale });
  const usersByOrg = new Map<string, typeof managers>();
  for (const user of managers) usersByOrg.set(user.organizationId, [...(usersByOrg.get(user.organizationId) ?? []), user]);

  return orgs.map((org) => {
    const manager = pickPrimaryManager(usersByOrg.get(org.id) ?? []);
    return {
      organizationId: org.id,
      name: org.name,
      createdAt: org.createdAt,
      records30: records.get(org.id) ?? 0,
      lastNps: lastNps.get(org.id) ?? null,
      hasActiveReview: withReview.has(org.id),
      lastRequestedAt: requestedAt.get(org.id) ?? null,
      manager: manager ? { name: manager.name, email: manager.email } : null,
    };
  });
}

/** ROOT → «Отзывы» → «Кого попросить об отзыве». */
export async function listReviewCandidates(now: Date = new Date()): Promise<ReviewCandidate[]> {
  return pickReviewCandidates(await loadCandidateInputs(now), now);
}

/** Почему организацию сейчас просить нельзя — человеческим текстом. */
function refusal(input: ReviewCandidateInput, now: Date): ReviewRequestError {
  if (input.hasActiveReview) return new ReviewRequestError("У заведения уже есть отзыв на проверке или опубликованный", 409);
  if (input.lastRequestedAt && now.getTime() - input.lastRequestedAt.getTime() < REVIEW_REQUEST_COOLDOWN_DAYS * DAY_MS) {
    return new ReviewRequestError(`Уже просили ${input.lastRequestedAt.toLocaleDateString("ru-RU")} — повторно через ${REVIEW_REQUEST_COOLDOWN_DAYS} дней`, 409);
  }
  if (!input.manager?.email.trim()) return new ReviewRequestError("У заведения нет руководителя с почтой", 422);
  return new ReviewRequestError(
    `Пока рано: нужно больше ${REVIEW_REQUEST_MIN_AGE_DAYS} дней в WeSetup и от ${REVIEW_REQUEST_MIN_RECORDS} записей за 30 дней`,
    409,
  );
}

/**
 * «Попросить отзыв»: письмо главному руководителю (не из стоп-листа) и
 * отметка `review.requested` в журнале действий платформы — только после
 * того, как письмо ушло. Повтор раньше 30 дней — 409.
 */
export async function requestReview(input: { organizationId: string; actorUserId: string; now?: Date; appUrl?: string }): Promise<{ email: string }> {
  const now = input.now ?? new Date();
  const [row] = await loadCandidateInputs(now, input.organizationId);
  if (!row) throw new ReviewRequestError("Организация не найдена", 404);
  const [candidate] = pickReviewCandidates([row], now);
  if (!candidate) throw refusal(row, now);

  const email = candidate.manager.email.trim().toLowerCase();
  const suppressed = await db.emailSuppression.findUnique({ where: { email }, select: { id: true } });
  if (suppressed) throw new ReviewRequestError("Руководитель отписался от писем WeSetup", 409);

  const mail = composeReviewRequestEmail({
    managerName: candidate.manager.name,
    organizationName: candidate.name,
    records30: candidate.records30,
    appUrl: input.appUrl ?? process.env.NEXTAUTH_URL ?? "https://wesetup.ru",
  });
  const sent = await sendRawEmail(email, mail.subject, renderEmailLayout(mail.title, mail.html), { replyTo: SUPPORT_EMAIL });
  if (!sent) throw new ReviewRequestError("Письмо не ушло — почтовый сервер не ответил", 502);

  await db.auditLog.create({
    data: {
      organizationId: platformOrgId(),
      userId: input.actorUserId,
      action: REVIEW_REQUEST_ACTION,
      entity: "Organization",
      entityId: candidate.organizationId,
      details: { email, organizationName: candidate.name, records30: candidate.records30 },
    },
  });
  return { email };
}
