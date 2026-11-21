import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { getActiveOrgId, isImpersonating, requireApiAuth } from "@/lib/auth-helpers";
import { isPointScoped } from "@/lib/point-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

import { ACCOUNT_OWNER_ONLY_MESSAGE, AccountTransferError } from "./account-transfer.server";

/**
 * Доступ к `/api/balance/account` и `/api/balance/transfer` (Р10.1): человек
 * с полным доступом, не в режиме «войти как» (чужие деньги) и не
 * руководитель точки. Что он владелец аккаунта активной организации или
 * управляющий сетью (серия E, Р5), проверяют сами функции перевода (403).
 */
export async function requireAccountTransferSession(): Promise<
  { ok: true; session: Session; organizationId: string } | { ok: false; response: NextResponse }
> {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!hasFullWorkspaceAccess(session.user) || isImpersonating(session) || isPointScoped(session.user)) {
    return {
      ok: false,
      response: NextResponse.json({ error: ACCOUNT_OWNER_ONLY_MESSAGE, code: "not_owner" }, { status: 403 }),
    };
  }
  return { ok: true, session, organizationId: getActiveOrgId(session) };
}

/** Отказ перевода → `{ error, code, params? }`; остальные ошибки — дальше (500). */
export function accountTransferErrorResponse(error: unknown): NextResponse {
  if (error instanceof AccountTransferError) {
    return NextResponse.json(
      { error: error.message, code: error.code, ...(error.params ? { params: error.params } : {}) },
      { status: error.status },
    );
  }
  throw error;
}
