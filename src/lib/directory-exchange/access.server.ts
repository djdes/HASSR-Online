import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { getActiveOrgId, isImpersonating, requireApiAuth } from "@/lib/auth-helpers";
import { BILLING_PAY_HREF } from "@/lib/billing-period";
import { db } from "@/lib/db";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import type { ExchangeActor } from "@/lib/directory-exchange/run.server";
import { EXCHANGE_OWNER_ONLY_MESSAGE } from "@/lib/directory-exchange/settings.server";
import { MASTER_ORG_KIND } from "@/lib/master-directory";
import { ORG_LOCKED_CODE, ORG_LOCKED_MESSAGE } from "@/lib/org-trial";
import { isOrganizationLocked } from "@/lib/org-trial.server";
import { COMPANY_ONLY_API_ERROR, isPointScoped } from "@/lib/point-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

/**
 * Доступ к маршрутам `/api/settings/directory-exchange` (правило Р7): менять
 * обмен и переносить данные может только владелец аккаунта активной
 * организации, с полным доступом и не в режиме «войти как».
 */

export type ExchangeOwnerContext = {
  session: Session;
  organizationId: string;
  accountId: string;
  actor: ExchangeActor;
};

type OwnerResult = { ok: true; context: ExchangeOwnerContext } | { ok: false; response: NextResponse };

const refuse = (error: string, status: number, extra: Record<string, unknown> = {}): { ok: false; response: NextResponse } => ({
  ok: false,
  response: NextResponse.json({ error, ...extra }, { status }),
});

/**
 * Владелец аккаунта активной организации. `allowLocked` — для чтения:
 * закрытой после своих 14 дней организации обмен и перенос отвечают 409.
 */
export async function requireExchangeOwner(options: { allowLocked?: boolean } = {}): Promise<OwnerResult> {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!hasFullWorkspaceAccess(session.user)) return refuse("Нет доступа", 403);
  if (isImpersonating(session)) return refuse(EXCHANGE_OWNER_ONLY_MESSAGE, 403);
  // Обмен — решение на всю компанию, не руководителя точки.
  if (isPointScoped(session.user)) return refuse(COMPANY_ONLY_API_ERROR, 403);

  const organizationId = getActiveOrgId(session);
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { accountId: true, isDemo: true, kind: true, account: { select: { ownerUserId: true } } },
  });
  if (!organization) return refuse("Организация не найдена", 404);
  if (!organization.accountId || organization.account?.ownerUserId !== session.user.id) {
    return refuse(EXCHANGE_OWNER_ONLY_MESSAGE, 403);
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
