import { recordAuditLog } from "@/lib/audit-log";
import { loadBillingUnit } from "@/lib/billing.server";
import { db } from "@/lib/db";
import {
  extendedOrgTrialEnd,
  ORG_TRIAL_MAX_GRANTS,
  orgTrialAdminState,
  readTrialReuseSuspicion,
  TRIAL_REUSE_ACTIONS,
  type OrgTrialAdminAction,
  type OrgTrialAdminState,
  type OrgTrialAdminView,
} from "@/lib/org-trial-admin";
import { invalidateOrganizationLock } from "@/lib/org-trial.server";

/**
 * Свои 14 дней организации у ROOT (серия B, Р11): показ в карточке
 * организации и три действия — продлить, снять отметку, обнулить счётчик
 * выданных. Доступ («Оплаты и тарифы») проверяет маршрут через `requireRoot`.
 */

const SUSPICIONS_SHOWN = 10;

export async function loadOrgTrialAdminView(organizationId: string, now: Date = new Date()): Promise<OrgTrialAdminView | null> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, trialEndsAt: true, accountId: true, account: { select: { orgTrialsGranted: true } } },
  });
  if (!org?.accountId || !org.account) return null;

  const [state, rows] = await Promise.all([
    adminState(org.id, org.trialEndsAt, now),
    db.auditLog.findMany({
      where: { entity: "account", entityId: org.accountId, action: { in: [...TRIAL_REUSE_ACTIONS] } },
      orderBy: { createdAt: "desc" },
      take: SUSPICIONS_SHOWN,
      select: { id: true, action: true, createdAt: true, details: true },
    }),
  ]);

  return {
    organizationId: org.id,
    accountId: org.accountId,
    trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
    state,
    grantsUsed: org.account.orgTrialsGranted,
    grantsMax: ORG_TRIAL_MAX_GRANTS,
    suspicions: rows.map(readTrialReuseSuspicion),
  };
}

/** Статус считает тариф аккаунта (`loadBillingUnit`); сбой — по одному сроку. */
async function adminState(organizationId: string, trialEndsAt: Date | null, now: Date): Promise<OrgTrialAdminState> {
  if (!trialEndsAt) return "none";
  try {
    const unit = await loadBillingUnit(organizationId, { now });
    return orgTrialAdminState(trialEndsAt, unit?.orgTrial?.status ?? null);
  } catch (error) {
    console.error("[org-trial-admin] billing unit failed", { organizationId, error });
    return trialEndsAt.getTime() > now.getTime() ? "trial" : "inactive";
  }
}

export type OrgTrialAdminErrorCode = "ORG_NOT_FOUND" | "ORG_NO_ACCOUNT" | "ORG_TRIAL_NO_MARK";

export class OrgTrialAdminError extends Error {
  constructor(
    readonly status: 404 | 409,
    readonly code: OrgTrialAdminErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OrgTrialAdminError";
  }
}

export type OrgTrialSnapshot = { trialEndsAt: string | null; orgTrialsGranted: number };

/**
 * Действие ROOT над своими 14 днями организации. Пишет журнал действий
 * организации (`root.org_trial.<action>`, «было/стало») и сразу сбрасывает
 * кеш «закрыта ли» у всех организаций аккаунта: точки раздаются по порядку,
 * и правка одной меняет статус соседних.
 */
export async function applyOrgTrialAdminAction(input: {
  organizationId: string;
  action: OrgTrialAdminAction;
  actor: { userId: string; userName: string | null };
  request?: Request;
  now?: Date;
}): Promise<{ before: OrgTrialSnapshot; after: OrgTrialSnapshot }> {
  const now = input.now ?? new Date();
  const org = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true, trialEndsAt: true, accountId: true, account: { select: { orgTrialsGranted: true } } },
  });
  if (!org) throw new OrgTrialAdminError(404, "ORG_NOT_FOUND", "Организация не найдена");
  if (!org.accountId || !org.account) throw new OrgTrialAdminError(409, "ORG_NO_ACCOUNT", "У организации нет аккаунта");
  const accountId = org.accountId;

  const before: OrgTrialSnapshot = {
    trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
    orgTrialsGranted: org.account.orgTrialsGranted,
  };
  const after: OrgTrialSnapshot = { ...before };
  const { action } = input;

  if (action.action === "extend" || action.action === "clear") {
    // Без отметки продлевать нечего: обычная организация в тарифе своих 14
    // дней не получала, а снимать — нечего.
    if (!org.trialEndsAt) {
      throw new OrgTrialAdminError(409, "ORG_TRIAL_NO_MARK", "У организации нет отметки своих 14 дней");
    }
    const trialEndsAt = action.action === "extend" ? extendedOrgTrialEnd(org.trialEndsAt, action.days, now) : null;
    await db.organization.update({ where: { id: org.id }, data: { trialEndsAt } });
    after.trialEndsAt = trialEndsAt?.toISOString() ?? null;
  } else {
    const updated = await db.account.update({
      where: { id: accountId },
      data: { orgTrialsGranted: 0 },
      select: { orgTrialsGranted: true },
    });
    after.orgTrialsGranted = updated.orgTrialsGranted;
  }

  const siblings = await db.organization.findMany({ where: { accountId }, select: { id: true } });
  invalidateOrganizationLock([org.id, ...siblings.map((row) => row.id)]);

  await recordAuditLog({
    request: input.request,
    session: { user: { id: input.actor.userId, name: input.actor.userName } },
    organizationId: org.id,
    action: `root.org_trial.${action.action}`,
    entity: "Organization",
    entityId: org.id,
    details: {
      accountId,
      ...(action.action === "extend" ? { days: action.days } : {}),
      before,
      after,
    },
  });

  return { before, after };
}
