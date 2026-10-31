import { db } from "@/lib/db";
import { ownerContact } from "@/lib/billing.server";
import { formatMskDay } from "@/lib/billing-period";
import { emailBrandForOrganization, renderEmailLayout, sendRawEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { organizationHasEntries } from "@/lib/org-activity.server";
import { platformOrgId } from "@/lib/partners/partner-hint";
import { isInactivePlan } from "@/lib/plan-limits";
import { SUPPORT_EMAIL } from "@/lib/support-chat-bus";
import { orgThreadKey } from "@/lib/support-threads-shared";
import {
  JOURNEY_ACTION,
  JOURNEY_FIRST_DAY,
  JOURNEY_LAST_DAY,
  JOURNEY_STEPS,
  composeJourneyEmail,
  isJourneyStep,
  nextJourneyStep,
  type JourneyStep,
} from "@/lib/newcomer-journey";

const DAY_MS = 24 * 60 * 60 * 1000;
const APP_URL = process.env.NEXTAUTH_URL || "https://wesetup.ru";

export type NewcomerJourneyReport = {
  scanned: number;
  sent: number;
  byStep: Record<JourneyStep, number>;
  failed: number;
};

/**
 * Письма первых шагов: русскоязычные организации 2–14 дней от регистрации,
 * кроме демо, платформенной, справочников и неактивных. Запускается из
 * ежедневной задачи биллинга. Повтор шага исключён записью в AuditLog;
 * адреса из стоп-листа рассылок и технические не получают ничего.
 */
export async function runNewcomerJourney(options: { now?: Date; dryRun?: boolean } = {}): Promise<NewcomerJourneyReport> {
  const now = options.now ?? new Date();
  const report: NewcomerJourneyReport = {
    scanned: 0,
    sent: 0,
    failed: 0,
    byStep: Object.fromEntries(JOURNEY_STEPS.map((step) => [step, 0])) as Record<JourneyStep, number>,
  };
  const organizations = await db.organization.findMany({
    where: {
      ...NOT_DIRECTORY_ORG_WHERE,
      isDemo: false,
      id: { not: platformOrgId() },
      locale: "ru",
      createdAt: {
        gte: new Date(now.getTime() - (JOURNEY_LAST_DAY + 1) * DAY_MS),
        lte: new Date(now.getTime() - JOURNEY_FIRST_DAY * DAY_MS),
      },
    },
    select: { id: true, name: true, createdAt: true, accountId: true, subscriptionPlan: true },
  });
  for (const org of organizations) {
    if (isInactivePlan(org.subscriptionPlan)) continue;
    report.scanned += 1;
    try {
      const sentRows = await db.auditLog.findMany({
        where: { organizationId: org.id, action: JOURNEY_ACTION },
        select: { details: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });
      const sentSteps = new Set<JourneyStep>();
      for (const row of sentRows) {
        const step = (row.details as { step?: unknown } | null)?.step;
        if (isJourneyStep(step)) sentSteps.add(step);
      }
      const [hasEntries, activeUsers, demo, clientMessage] = await Promise.all([
        organizationHasEntries(org.id),
        db.user.count({ where: { organizationId: org.id, isActive: true, archivedAt: null, isRoot: false } }),
        org.accountId
          ? db.organization.findFirst({
              where: { accountId: org.accountId, isDemo: true, demoExpiresAt: { gt: now } },
              select: { demoExpiresAt: true },
            })
          : Promise.resolve(null),
        db.supportMessage.findFirst({
          where: { thread: { key: orgThreadKey(org.id) }, author: "client", createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
          select: { id: true },
        }),
      ]);
      const step = nextJourneyStep({
        createdAt: org.createdAt,
        now,
        hasEntries,
        activeUsers,
        demoExpiresAt: demo?.demoExpiresAt ?? null,
        sentSteps,
        lastSentAt: sentRows[0]?.createdAt ?? null,
        wroteSupportRecently: Boolean(clientMessage),
      });
      if (!step) continue;

      const owner = await ownerContact(org.id);
      const email = owner?.email?.trim().toLowerCase();
      if (!owner || !email) continue;
      const suppressed = await db.emailSuppression.findUnique({ where: { email }, select: { id: true } });
      if (suppressed) continue;

      if (options.dryRun) {
        report.sent += 1;
        report.byStep[step] += 1;
        continue;
      }
      const mail = composeJourneyEmail(step, {
        orgName: escapeHtml(org.name),
        appUrl: APP_URL,
        demoUntil: demo?.demoExpiresAt ? formatMskDay(demo.demoExpiresAt) : null,
      });
      const html = renderEmailLayout(mail.title, mail.html, await emailBrandForOrganization(org.id));
      const delivered = await sendRawEmail(email, mail.subject, html, { replyTo: SUPPORT_EMAIL });
      if (!delivered) {
        report.failed += 1;
        continue;
      }
      await db.auditLog.create({
        data: {
          organizationId: org.id,
          userId: owner.userId,
          userName: "WeSetup",
          action: JOURNEY_ACTION,
          entity: "organization",
          entityId: org.id,
          details: { step },
        },
      });
      report.sent += 1;
      report.byStep[step] += 1;
    } catch (error) {
      report.failed += 1;
      console.error("[newcomer-journey] organization failed", { organizationId: org.id, error });
    }
  }
  console.info("[newcomer-journey] done", { dryRun: options.dryRun === true, ...report });
  return report;
}
