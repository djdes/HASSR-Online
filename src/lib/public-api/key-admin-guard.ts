import type { Session } from "next-auth";
import { getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

/**
 * Кто может выпускать и отзывать ключи: руководитель организации сам.
 * ROOT в режиме «войти как» и партнёр в кабинете клиента — нет: ключ
 * действует от имени владельца, и чужой ключ в организации клиента был
 * бы бэкдором.
 */
export function keyAdminGuard(
  session: Session
): { ok: true; orgId: string; user: { id: string; name: string } } | { ok: false; status: 403; code: "role" | "impersonation" | "partner"; error: string } {
  if (!hasFullWorkspaceAccess({ role: session.user.role, isRoot: session.user.isRoot === true })) {
    return { ok: false, status: 403, code: "role", error: "Ключи выпускает руководитель" };
  }
  if (isImpersonating(session)) {
    return { ok: false, status: 403, code: "impersonation", error: "Ключ выпускает сам руководитель организации" };
  }
  if (session.user.partnerAccess) {
    return { ok: false, status: 403, code: "partner", error: "Партнёр не выпускает ключи клиента" };
  }
  return {
    ok: true,
    orgId: getActiveOrgId(session),
    user: { id: session.user.id, name: session.user.name ?? "" },
  };
}
