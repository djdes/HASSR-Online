import { NextResponse } from "next/server";

import { advisoryLockKey, withAdvisoryTryLock } from "@/lib/advisory-lock";
import { recordAuditLog } from "@/lib/audit-log";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isEmailDeliveryConfigured, sendColleagueRecommendationEmail } from "@/lib/email";
import { domainAcceptsMail } from "@/lib/mail-domain";
import {
  NPS_RECOMMEND_AUDIT_ACTION,
  NPS_RECOMMEND_AUDIT_ENTITY,
  runNpsRecommendation,
  type NpsRecommendDeps,
} from "@/lib/nps-recommend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { responseId, email, message } — письмо коллеге после оценки 4–5
 * в опросе «Посоветуете WeSetup коллегам?». Проверки, лимиты и сборка
 * письма — в `src/lib/nps-recommend.ts`; здесь только база и почта.
 */
export async function POST(request: Request) {
  const session = await requireAuth();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const deps: NpsRecommendDeps = {
    appUrl: process.env.NEXTAUTH_URL || "https://wesetup.ru",
    now: () => new Date(),
    findResponse: (id) =>
      db.npsResponse.findUnique({
        where: { id },
        select: { id: true, userId: true, organizationId: true, score: true, scale: true },
      }),
    loadSender: (userId) => db.user.findUnique({ where: { id: userId }, select: { name: true, email: true, contactEmail: true } }),
    loadOrganization: (organizationId) =>
      db.organization.findUnique({ where: { id: organizationId }, select: { name: true, referralCode: true } }),
    isOrganizationStaffEmail: async (organizationId, email) => {
      const count = await db.user.count({
        where: {
          AND: [
            { OR: [{ email: { equals: email, mode: "insensitive" } }, { contactEmail: { equals: email, mode: "insensitive" } }] },
            { OR: [{ organizationId }, { organizationMemberships: { some: { organizationId } } }] },
          ],
        },
      });
      return count > 0;
    },
    domainAcceptsMail,
    withOrganizationLock: (organizationId, fn) =>
      withAdvisoryTryLock(advisoryLockKey("nps-recommend", organizationId), fn, { attempts: 20, delayMs: 150, timeoutMs: 30_000 }),
    countSent: ({ since, userId, organizationId, recipient }) =>
      db.auditLog.count({
        where: {
          // entity первым — запрос идёт по индексу [entity, entityId].
          entity: NPS_RECOMMEND_AUDIT_ENTITY,
          action: NPS_RECOMMEND_AUDIT_ACTION,
          createdAt: { gte: since },
          ...(userId ? { userId } : {}),
          ...(organizationId ? { organizationId } : {}),
          ...(recipient ? { details: { path: ["colleagueEmail"], equals: recipient } } : {}),
        },
      }),
    sendEmail: async (params) => {
      const accepted = await sendColleagueRecommendationEmail(params).catch((error) => {
        console.error("[nps] sendColleagueRecommendationEmail failed", error);
        return false;
      });
      if (accepted) return "sent";
      // Почта не настроена (dev-копии): письмо целиком записано в лог сервера.
      return isEmailDeliveryConfigured() ? "failed" : "logged";
    },
    recordAudit: ({ organizationId, responseId, details }) =>
      recordAuditLog({
        request,
        session,
        organizationId,
        action: NPS_RECOMMEND_AUDIT_ACTION,
        entity: NPS_RECOMMEND_AUDIT_ENTITY,
        entityId: responseId,
        details,
      }),
  };

  const result = await runNpsRecommendation({ userId: session.user.id, body }, deps);
  if (result.status === 200) {
    console.info(
      `[nps] рекомендация коллеге: user=${session.user.id} referral=${result.body.referral} delivery=${result.body.delivery}`,
    );
  } else if (result.status === 502) {
    console.error(`[nps] рекомендация коллеге не ушла: user=${session.user.id}`);
  }
  return NextResponse.json(result.body, { status: result.status });
}
