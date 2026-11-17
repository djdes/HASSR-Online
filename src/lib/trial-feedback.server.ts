import { db } from "@/lib/db";
import { COMPANY_EMAIL, COMPANY_PHONE } from "@/lib/company-contacts";
import { escapeHtml } from "@/lib/html-escape";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { escapeTelegramHtml } from "@/lib/telegram";
import {
  composeTrialFeedbackEmail,
  TRIAL_FEEDBACK_ACTION,
  TRIAL_FEEDBACK_ANSWERS,
  TRIAL_FEEDBACK_REQUEST_ACTION,
  trialFeedbackAdminText,
  trialFeedbackDue,
  type TrialFeedbackAnswer,
  type TrialFeedbackStats,
} from "@/lib/trial-feedback";
import { signTrialFeedbackToken, trialFeedbackHref } from "@/lib/trial-feedback-token";

/**
 * Запрос отзыва после пробного (спека trial-emails-rename-2026-11): цифры
 * пробного, отправка письма владельцу, ежедневный проход и запись ответа.
 * Правила и тексты — `trial-feedback.ts`.
 */

const APP_URL = () => (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(/\/+$/, "");

/** Записи и журналы за пробный: с начала аккаунта до конца пробного. */
export async function trialFeedbackStats(params: {
  orgIds: string[];
  from: Date;
  to: Date;
  employees: number;
}): Promise<TrialFeedbackStats> {
  const createdAt = { gte: params.from, lte: params.to };
  const [legacy, documents] = await Promise.all([
    db.journalEntry.groupBy({
      by: ["templateId"],
      where: { organizationId: { in: params.orgIds }, createdAt },
      _count: { _all: true },
    }),
    db.journalDocument.findMany({
      where: { organizationId: { in: params.orgIds } },
      select: { templateId: true, _count: { select: { entries: { where: { createdAt } } } } },
    }),
  ]);
  const byTemplate = new Map<string, number>();
  for (const row of legacy) byTemplate.set(row.templateId, (byTemplate.get(row.templateId) ?? 0) + row._count._all);
  for (const doc of documents) {
    if (doc._count.entries > 0) byTemplate.set(doc.templateId, (byTemplate.get(doc.templateId) ?? 0) + doc._count.entries);
  }
  const entries = [...byTemplate.values()].reduce((sum, n) => sum + n, 0);
  const topId = [...byTemplate.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const top = topId ? await db.journalTemplate.findUnique({ where: { id: topId }, select: { name: true } }) : null;
  return { entries, journals: byTemplate.size, employees: params.employees, topJournal: top?.name ?? null };
}

export type TrialFeedbackSendResult = { sent: boolean; reason?: "no_owner" | "no_email" | "failed" };

/**
 * Письмо-запрос владельцу единицы биллинга. `force` — ручная отправка из
 * /root: без проверки «уже спрашивали». Запись в аудит — только при отправке.
 */
export async function sendTrialFeedbackRequest(params: {
  organizationId: string;
  organizationName: string;
  orgIds: string[];
  trialStartedAt: Date;
  trialEndsAt: Date;
  employees: number;
  actor?: { userId: string; userName: string | null } | null;
  manual?: boolean;
}): Promise<TrialFeedbackSendResult> {
  const { ownerContact } = await import("@/lib/billing.server");
  const owner = await ownerContact(params.organizationId);
  if (!owner) return { sent: false, reason: "no_owner" };
  if (!owner.email) return { sent: false, reason: "no_email" };
  const stats = await trialFeedbackStats({
    orgIds: params.orgIds,
    from: params.trialStartedAt,
    to: params.trialEndsAt,
    employees: params.employees,
  });
  const token = signTrialFeedbackToken({ organizationId: params.organizationId, userId: owner.userId });
  const links = Object.fromEntries(
    TRIAL_FEEDBACK_ANSWERS.map((answer) => [answer, `${APP_URL()}${trialFeedbackHref(token, answer)}`]),
  ) as Record<TrialFeedbackAnswer, string>;
  const mail = composeTrialFeedbackEmail({
    name: owner.name,
    organizationName: params.organizationName,
    stats,
    links,
    phone: COMPANY_PHONE.display,
    escape: escapeHtml,
  });
  const { emailBrandForOrganization, renderEmailLayout, sendRawEmail } = await import("@/lib/email");
  const html = renderEmailLayout(mail.title, mail.html, await emailBrandForOrganization(params.organizationId));
  const sent = await sendRawEmail(owner.email, mail.subject, html, { replyTo: COMPANY_EMAIL, text: mail.text }).catch((error) => {
    console.error("[trial-feedback] email failed", error);
    return false;
  });
  if (!sent) return { sent: false, reason: "failed" };
  await db.auditLog.create({
    data: {
      organizationId: params.organizationId,
      userId: params.actor?.userId ?? null,
      userName: params.actor?.userName ?? "WeSetup",
      // Ручная отправка — своей записью: автоматический запрос после конца
      // пробного она не отменяет.
      action: params.manual ? `${TRIAL_FEEDBACK_REQUEST_ACTION}.manual` : TRIAL_FEEDBACK_REQUEST_ACTION,
      entity: "organization",
      entityId: params.organizationId,
      details: { trialEndsAt: params.trialEndsAt.toISOString(), to: owner.email, stats, manual: params.manual === true },
    },
  });
  return { sent: true };
}

export type TrialFeedbackJobReport = { scanned: number; due: number; sent: number; failed: number };

/** Ежедневный проход (крон биллинга): кому пора задать вопрос — письмо. */
export async function runTrialFeedbackJob(options: { now?: Date; dryRun?: boolean } = {}): Promise<TrialFeedbackJobReport> {
  const now = options.now ?? new Date();
  const { listBillingUnits, readTrialSettings, stateForUnit } = await import("@/lib/billing.server");
  const [settings, units] = await Promise.all([readTrialSettings(), listBillingUnits()]);
  const report: TrialFeedbackJobReport = { scanned: units.length, due: 0, sent: 0, failed: 0 };
  for (const unit of units) {
    const state = stateForUnit(unit, settings, now);
    const precheck = { kind: state.kind, reason: state.reason, trialEndsAt: state.trialEndsAt, inactive: unit.inactive, exempt: unit.exempt, now };
    if (!trialFeedbackDue({ ...precheck, alreadyAsked: false })) continue;
    const asked = await db.auditLog.findFirst({
      where: { organizationId: { in: unit.scopeOrgIds }, action: TRIAL_FEEDBACK_REQUEST_ACTION },
      select: { id: true },
    });
    if (!trialFeedbackDue({ ...precheck, alreadyAsked: Boolean(asked) }) || !state.trialEndsAt) continue;
    report.due += 1;
    if (options.dryRun) continue;
    try {
      const result = await sendTrialFeedbackRequest({
        organizationId: unit.organizationId,
        organizationName: unit.organizationName,
        orgIds: unit.scopeOrgIds,
        trialStartedAt: unit.createdAt,
        trialEndsAt: state.trialEndsAt,
        employees: unit.activeUsers,
      });
      if (result.sent) report.sent += 1;
      else if (result.reason === "failed") report.failed += 1;
    } catch (error) {
      report.failed += 1;
      console.error("[trial-feedback] unit failed", { unit: unit.key, error });
    }
  }
  console.info("[trial-feedback] done", report);
  return report;
}

/** Ответ со страницы `/trial-feedback`: аудит организации и сообщение продажам. */
export async function recordTrialFeedback(params: {
  organizationId: string;
  userId: string;
  answer: TrialFeedbackAnswer;
  comment: string | null;
  ip: string | null;
}): Promise<boolean> {
  const [organization, user] = await Promise.all([
    db.organization.findUnique({ where: { id: params.organizationId }, select: { name: true } }),
    db.user.findFirst({ where: { id: params.userId, organizationId: params.organizationId }, select: { name: true, email: true } }),
  ]);
  if (!organization) return false;
  const row = await db.auditLog.create({
    data: {
      organizationId: params.organizationId,
      userId: user ? params.userId : null,
      userName: user?.name ?? null,
      action: TRIAL_FEEDBACK_ACTION,
      entity: "organization",
      entityId: params.organizationId,
      details: { answer: params.answer, comment: params.comment },
      ipAddress: params.ip,
    },
    select: { id: true },
  });
  try {
    await notifyPlatformAdmin(
      trialFeedbackAdminText({
        organizationName: organization.name,
        answer: params.answer,
        comment: params.comment,
        email: user?.email ?? null,
        escape: escapeTelegramHtml,
      }),
      { kind: "trial_feedback", dedupeKey: `trial_feedback:${row.id}`, email: false, audience: "sales" },
    );
  } catch (error) {
    console.error("[trial-feedback] admin notify failed", error);
  }
  return true;
}
