import type { Session } from "next-auth";
import { forbidden } from "next/navigation";
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { ppkScopeAllowed, type PpkScope } from "./scope";
import { ppkScopeForSession } from "./scope.server";

/**
 * Доступ к разделу «Производственный контроль» в API: руководство организации
 * (полный доступ к кабинету) или ROOT. Остальным — 403.
 *
 * ППК на точку (2026-11-01): `scope` — ППК точки из шапки или организации
 * (`ppkScopeForSession`). Руководитель точки работает только с ППК своей
 * точки — уровень организации и чужая точка ему закрыты.
 */
export async function requirePpkAccess(): Promise<
  | { ok: true; session: Session; organizationId: string; scope: PpkScope }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Нет доступа к разделу" }, { status: 403 }),
    };
  }
  const scope = await ppkScopeForSession(auth.session);
  if (!ppkScopeAllowed(auth.session, scope)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Выберите свою точку в шапке: ППК ведётся для каждой точки" }, { status: 403 }),
    };
  }
  return { ok: true, session: auth.session, organizationId: scope.organizationId, scope };
}

export { ppkScopeAllowed } from "./scope";

/**
 * Область ППК страницы раздела: точка из шапки или организация. Руководитель
 * точки на чужой точке или уровне организации — «Нет доступа».
 */
export async function ppkPageScope(session: Session): Promise<PpkScope> {
  const scope = await ppkScopeForSession(session);
  if (!ppkScopeAllowed(session, scope)) forbidden();
  return scope;
}
