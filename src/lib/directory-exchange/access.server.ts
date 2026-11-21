import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { canManageNetworkRole, isAccountOwnerRole, type AccountRole } from "@/lib/account-roles";
import { accountRoleForOrganization } from "@/lib/account-roles.server";
import { getActiveOrgId, isImpersonating, requireApiAuth } from "@/lib/auth-helpers";
import { BILLING_PAY_HREF } from "@/lib/billing-period";
import { db } from "@/lib/db";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import type { ExchangeActor } from "@/lib/directory-exchange/run.server";
import { EXCHANGE_ACCOUNT_OWNER_ONLY_MESSAGE, EXCHANGE_OWNER_ONLY_MESSAGE } from "@/lib/directory-exchange/settings.server";
import { MASTER_ORG_KIND } from "@/lib/master-directory";
import { ORG_LOCKED_CODE, ORG_LOCKED_MESSAGE } from "@/lib/org-trial";
import { isOrganizationLocked } from "@/lib/org-trial.server";
import { COMPANY_ONLY_API_ERROR, isPointScoped } from "@/lib/point-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

/**
 * Доступ к маршрутам `/api/settings/directory-exchange` (правило Р7, серия E
 * Р5): менять обмен и переносить данные может владелец аккаунта активной
 * организации или назначенный им управляющий сетью — с полным доступом, не в
 * режиме «войти как» и не руководитель точки. Запросы другой компании —
 * только владелец (`requireExchangeOwner`).
 */

export type ExchangeOwnerContext = {
  session: Session;
  organizationId: string;
  accountId: string;
  /** Кто действует: владелец аккаунта или управляющий сетью — его имя пишется в журнал. */
  actor: ExchangeActor;
  role: AccountRole;
  /** Владелец аккаунта (кабинет обмена заводится на него). */
  ownerUserId: string;
};

type OwnerResult = { ok: true; context: ExchangeOwnerContext } | { ok: false; response: NextResponse };

const refuse = (error: string, status: number, extra: Record<string, unknown> = {}): { ok: false; response: NextResponse } => ({
  ok: false,
  response: NextResponse.json({ error, ...extra }, { status }),
});

type ExchangeAccessOptions = {
  /** Для чтения: закрытой после своих 14 дней организации обмен и перенос отвечают 409. */
  allowLocked?: boolean;
  /** Только владелец аккаунта (запросы другой компании), управляющему сетью — 403. */
  ownerOnly?: boolean;
};

/** Владелец аккаунта активной организации — запросы и связи с другой компанией. */
export async function requireExchangeOwner(options: { allowLocked?: boolean } = {}): Promise<OwnerResult> {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  return exchangeAccessForSession(auth.session, { ...options, ownerOnly: true });
}

/** Владелец аккаунта или управляющий сетью: настройка, обмен, перенос, пропуски, история, код. */
export async function requireExchangeManager(options: { allowLocked?: boolean } = {}): Promise<OwnerResult> {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  return exchangeAccessForSession(auth.session, options);
}

/** Проверки по уже прочитанной сессии (маршруты и сквозные проверки). */
export async function exchangeAccessForSession(session: Session, options: ExchangeAccessOptions = {}): Promise<OwnerResult> {
  if (!hasFullWorkspaceAccess(session.user)) return refuse("Нет доступа", 403);
  if (isImpersonating(session)) return refuse(EXCHANGE_OWNER_ONLY_MESSAGE, 403);
  // Обмен — решение на всю компанию, не руководителя точки.
  if (isPointScoped(session.user)) return refuse(COMPANY_ONLY_API_ERROR, 403);

  const organizationId = getActiveOrgId(session);
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { accountId: true, isDemo: true, kind: true },
  });
  if (!organization) return refuse("Организация не найдена", 404);
  // Роль — по базе на каждый запрос: снятый управляющий теряет доступ сразу.
  const access = organization.accountId ? await accountRoleForOrganization(session.user.id, organizationId) : null;
  const role = access?.role ?? null;
  const allowed = options.ownerOnly ? isAccountOwnerRole(role) : canManageNetworkRole(role);
  if (!access || !organization.accountId || !role || !allowed) {
    return refuse(options.ownerOnly ? EXCHANGE_ACCOUNT_OWNER_ONLY_MESSAGE : EXCHANGE_OWNER_ONLY_MESSAGE, 403);
  }
  if (organization.isDemo || organization.kind === MASTER_ORG_KIND) {
    return refuse("В этой организации обмен справочниками недоступен", 403);
  }
  if (!options.allowLocked && (await isOrganizationLocked(organizationId))) {
    return refuse(ORG_LOCKED_MESSAGE, 409, { code: ORG_LOCKED_CODE, payUrl: BILLING_PAY_HREF });
  }
  return {
    ok: true,
    context: {
      session,
      organizationId,
      accountId: organization.accountId,
      actor: { userId: session.user.id, userName: session.user.name ?? null },
      role,
      ownerUserId: access.ownerUserId,
    },
  };
}

/** Ответ на отказ обмена; остальные ошибки пробрасываются дальше (500). */
export function exchangeErrorResponse(error: unknown): NextResponse {
  if (error instanceof DirectoryExchangeError) {
    return NextResponse.json(
      {
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        // Закрытая организация и запрос в другую компанию без платного тарифа — со ссылкой на оплату.
        ...(error.code === ORG_LOCKED_CODE || error.status === 402 ? { payUrl: BILLING_PAY_HREF } : {}),
      },
      { status: error.status },
    );
  }
  throw error;
}
