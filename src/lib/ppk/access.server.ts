import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

/**
 * Доступ к разделу «Производственный контроль» в API: руководство организации
 * (полный доступ к кабинету) или ROOT. Остальным — 403.
 */
export async function requirePpkAccess(): Promise<
  | { ok: true; session: Session; organizationId: string }
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
  return { ok: true, session: auth.session, organizationId: getActiveOrgId(auth.session) };
}
