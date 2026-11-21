import type { Session } from "next-auth";

import { canManageNetwork } from "@/lib/account-roles.server";
import { getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { NETWORK_MIN_ORGS, isNetworkOwner, isNetworkViewer } from "@/lib/network-summary";
import { isPointScoped } from "@/lib/point-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

const platformOrgId = () => (process.env.PLATFORM_ORG_ID ?? "platform").trim();

/**
 * Рабочие организации аккаунта для «Сети» (серия D, Р4): без демо,
 * мастер-кабинетов и платформы — как баланс по аккаунту.
 */
export function networkOrgWhere(accountId?: string) {
  return {
    ...(accountId ? { accountId } : {}),
    isDemo: false,
    ...NOT_DIRECTORY_ORG_WHERE,
    id: { not: platformOrgId() },
  };
}

/**
 * Факт меню «Сеть» (`NavFacts.accountNetwork`): владелец аккаунта или
 * управляющий сетью, только людям с полным доступом не в «войти как» и не
 * руководителям точки. Владельцу — один запрос. Модуль лёгкий — его грузит
 * меню на каждой странице.
 */
export async function loadAccountNetworkFact(session: Session): Promise<boolean> {
  const user = session.user;
  if (
    !isNetworkViewer({
      fullAccess: hasFullWorkspaceAccess(user),
      impersonating: isImpersonating(session),
      pointScoped: isPointScoped(user),
    })
  ) {
    return false;
  }
  const org = await db.organization.findUnique({
    where: { id: getActiveOrgId(session) },
    select: {
      accountId: true,
      account: {
        select: {
          ownerUserId: true,
          _count: { select: { organizations: { where: networkOrgWhere() } } },
        },
      },
    },
  });
  const organizations = org?.account?._count.organizations ?? 0;
  if (!org?.accountId || organizations < NETWORK_MIN_ORGS) return false;
  if (isNetworkOwner({ userId: user.id, ownerUserId: org.account?.ownerUserId ?? null, organizations })) return true;
  // Управляющий сетью (серия E, Р5): ещё запрос — только руководителям сети из двух организаций и больше.
  return canManageNetwork(user.id, org.accountId);
}
