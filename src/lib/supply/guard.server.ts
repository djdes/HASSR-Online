import { NextResponse } from "next/server";

import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

/**
 * Входящие накладные и подключения ЭДО — для руководства, как приёмка из
 * «Меркурия» (`/api/mercury/documents/[id]/process`).
 */
export async function guardSupply() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return { session, organizationId: "", denied: NextResponse.json({ error: "Доступно руководителям" }, { status: 403 }) };
  }
  return { session, organizationId: getActiveOrgId(session), denied: null };
}
