import { db } from "@/lib/db";
import { NPS_HIDDEN, shouldAskNps, type NpsVisibility } from "@/lib/nps";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

/**
 * Показ опроса этому пользователю (только руководству, не ROOT, не в демо).
 * `ask` — спросить сейчас по правилам 14/90 дней; `eligible` — блок можно
 * показать по ссылке `?nps=1` в любой момент (см. `NPS_PREVIEW_PARAM`).
 */
export async function npsVisibilityFor(session: { user: { id: string; role?: string | null; isRoot?: boolean | null; organizationId: string } }, now: Date = new Date()): Promise<NpsVisibility> {
  if (!hasFullWorkspaceAccess(session.user) || session.user.isRoot) return NPS_HIDDEN;
  const [user, org] = await Promise.all([
    db.user.findUnique({ where: { id: session.user.id }, select: { npsAskedAt: true } }),
    db.organization.findUnique({ where: { id: session.user.organizationId }, select: { createdAt: true, isDemo: true } }),
  ]);
  if (!user || !org || org.isDemo) return NPS_HIDDEN;
  return { eligible: true, ask: shouldAskNps({ orgCreatedAt: org.createdAt, npsAskedAt: user.npsAskedAt, now }) };
}
