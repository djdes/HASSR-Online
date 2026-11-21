import type { Session } from "next-auth";

import { getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { isNetworkViewer, type NetworkOrgRow, type NetworkTotals } from "@/lib/network-summary";
import { NetworkSummaryAccessError, loadNetworkSummary } from "@/lib/network-summary.server";
import { listAccessibleOrganizations } from "@/lib/organization-access";
import { isPointScoped } from "@/lib/point-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

/**
 * «Сеть» в мини-приложении (серия E, Р8): та же сводка, что на странице
 * «Сеть» (`loadNetworkSummary`), компактно — журналы сегодня, баланс, свои
 * 14 дней и «Перейти». Владельцу аккаунта и управляющему сетью с полным
 * доступом, не в «войти как» и не руководителю точки, в аккаунте две
 * организации и больше; остальным — null (страница уводит с пометкой).
 */

export type MiniNetworkRow = Pick<NetworkOrgRow, "id" | "name" | "current" | "journals" | "journalStatus" | "balanceRub" | "trial"> & {
  /** Переключиться можно: человек — участник организации (у управляющего — не во всех). */
  canOpen: boolean;
};

export type MiniNetworkView = {
  rows: MiniNetworkRow[];
  totals: NetworkTotals;
  truncated: boolean;
};

export async function loadMiniNetwork(session: Session, now?: Date): Promise<MiniNetworkView | null> {
  const user = session.user;
  if (
    !isNetworkViewer({
      fullAccess: hasFullWorkspaceAccess(user),
      impersonating: isImpersonating(session),
      pointScoped: isPointScoped(user),
    })
  ) {
    return null;
  }
  const summary = await loadNetworkSummary({ ownerUserId: user.id, activeOrgId: getActiveOrgId(session), now }).catch(
    (error: unknown) => {
      if (error instanceof NetworkSummaryAccessError) return null;
      throw error;
    },
  );
  if (!summary) return null;
  const accessible = new Set((await listAccessibleOrganizations(user.id)).map((organization) => organization.id));
  return {
    rows: summary.rows.map((row) => ({
      id: row.id,
      name: row.name,
      current: row.current,
      journals: row.journals,
      journalStatus: row.journalStatus,
      balanceRub: row.balanceRub,
      trial: row.trial,
      canOpen: row.current || accessible.has(row.id),
    })),
    totals: summary.totals,
    truncated: summary.truncated,
  };
}
