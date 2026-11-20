import type { Session } from "next-auth";

import { getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { isNetworkOwner, isNetworkViewer } from "@/lib/network-summary";
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
 * Факт меню «Сеть» (`NavFacts.accountNetwork`): один запрос и только людям
 * с полным доступом не в «войти как» и не руководителям точки. Модуль
 * лёгкий — его грузит меню на каждой странице.
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
      account: {
        select: {
          ownerUserId: true,
          _count: { select: { organizations: { where: networkOrgWhere() } } },
        },
      },
    },
  });
  return isNetworkOwner({
    userId: user.id,
    ownerUserId: org?.account?.ownerUserId ?? null,
    organizations: org?.account?._count.organizations ?? 0,
  });
}
