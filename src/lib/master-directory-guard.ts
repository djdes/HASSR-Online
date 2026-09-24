import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { getActiveOrgId } from "@/lib/auth-helpers";
import { authOptions } from "@/lib/auth";
import { readOrgKind } from "@/lib/master-directory";
import { DIRECTORY_ONLY_API_ERROR } from "@/lib/master-directory-access";
import { getServerSession } from "@/lib/server-session";

/**
 * Доступ к `/api/master/*`: активная организация сессии — мастер-кабинет
 * справочников (`kind="directory"`). Proxy уже отсёк чужие сессии по
 * токену; здесь — второй рубеж по базе.
 */
export async function requireMasterDirectorySession(): Promise<
  { ok: true; session: Session; masterOrgId: string } | { ok: false; response: NextResponse }
> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Не авторизован" }, { status: 401 }) };
  }
  const masterOrgId = getActiveOrgId(session);
  if ((await readOrgKind(masterOrgId)) !== "directory") {
    return { ok: false, response: NextResponse.json({ error: DIRECTORY_ONLY_API_ERROR }, { status: 403 }) };
  }
  return { ok: true, session, masterOrgId };
}
