import { cache } from "react";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { normalizePlatformSections, type PlatformViewer } from "@/lib/platform-access";

/**
 * Fresh platform access of a signed-in person. Superadmin comes from the
 * session (revoking it bumps the session version); delegated sections are
 * re-read from the DB on every request, so a revoked section closes at once.
 */
export const loadPlatformViewer = cache(async (userId: string, isRoot: boolean): Promise<PlatformViewer> => {
  if (isRoot) return { superadmin: true, sections: [] };
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { platformSections: true, isActive: true, archivedAt: true },
  });
  if (!user || !user.isActive || user.archivedAt) return { superadmin: false, sections: [] };
  return { superadmin: false, sections: normalizePlatformSections(user.platformSections) };
});

export function platformViewerForSession(session: Session): Promise<PlatformViewer> {
  return loadPlatformViewer(session.user.id, session.user.isRoot === true);
}
