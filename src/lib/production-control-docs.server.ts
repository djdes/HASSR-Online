import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { ppkScopeAllowed } from "@/lib/ppk/access.server";
import { ppkScopeForSession } from "@/lib/ppk/scope.server";

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
  // ППК на точку (2026-11-01): документы точки из шапки или организации;
  // руководитель точки — только своей точки.
  const scope = await ppkScopeForSession(auth.session);
  if (!ppkScopeAllowed(auth.session, scope)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Выберите свою точку в шапке: ППК ведётся для каждой точки" }, { status: 403 }),
    };
  }
  return { ...auth, organizationId: getActiveOrgId(auth.session), scope };
}
