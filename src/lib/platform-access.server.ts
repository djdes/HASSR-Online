import { cache } from "react";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { effectivePlatformSections, normalizePlatformScope, type PlatformViewer, type ScopedTarget } from "@/lib/platform-access";

/**
 * Fresh platform access of a signed-in person. Superadmin comes from the
 * session (revoking it bumps the session version); delegated sections (plus
 * «Переводы» for a translator) and the data scope of the role are re-read
 * from the DB on every request, so a revoked section closes at once.
 */
export const loadPlatformViewer = cache(async (userId: string, isRoot: boolean): Promise<PlatformViewer> => {
  if (isRoot) return { superadmin: true, sections: [], scope: "all" };
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { platformSections: true, canEditTranslations: true, isActive: true, archivedAt: true, platformRole: { select: { scope: true } } },
  });
  if (!user || !user.isActive || user.archivedAt) return { superadmin: false, sections: [], scope: "all" };
  return {
    superadmin: false,
    sections: effectivePlatformSections(user),
    scope: normalizePlatformScope(user.platformRole?.scope),
  };
});

export function platformViewerForSession(session: Session): Promise<PlatformViewer> {
  return loadPlatformViewer(session.user.id, session.user.isRoot === true);
}

/**
 * Охват «свои»: клиент — закреплён за человеком; лид — его или свободный
 * (без ответственного, его можно «Взять себе»). Нет такой записи — тоже
 * «нет»: адрес не должен подсказывать, существует ли чужой клиент.
 */
export async function isTargetInOwnScope(userId: string, target: ScopedTarget): Promise<boolean> {
  if (target.kind === "organization") {
    const org = await db.organization.findUnique({ where: { id: target.id }, select: { accountManagerId: true } });
    return org?.accountManagerId === userId;
  }
  const contact = await db.crmContact.findUnique({ where: { id: target.id }, select: { ownerId: true } });
  return Boolean(contact) && (contact!.ownerId === null || contact!.ownerId === userId);
}
