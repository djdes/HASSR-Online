import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

/**
 * Доступ к документам «Производственного контроля».
 *   • смотреть — руководство и тот, кто проверяет задачи (заведующая):
 *     проверяющий может прийти, когда на месте только она;
 *   • загружать и удалять — `admin.full`, как базу знаний.
 */
export async function requireProductionDocsAccess(manage = false) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  const user = auth.session.user;
  const allowed = manage
    ? hasCapability(user, "admin.full")
    : hasFullWorkspaceAccess(user) || hasCapability(user, "tasks.verify");
  if (!allowed) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Нет доступа к документам" }, { status: 403 }),
    };
  }
  return { ...auth, organizationId: getActiveOrgId(auth.session) };
}
