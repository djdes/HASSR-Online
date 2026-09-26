import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { expireSignOutCookies } from "@/lib/auth-cookies";
import { requireAuth } from "@/lib/auth-helpers";
import { bumpSessionVersion } from "@/lib/session-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — завершить все сессии: версия сессий растёт, все выданные
 * токены (на всех устройствах, включая это) перестают проходить.
 * Куки этого браузера чистим сразу и так же полно, как обычный выход
 * (все имена сессии): раньше легаси-имена здесь не гасились — строки
 * `headers.append` пропадали при следующем `cookies.set`.
 */
export async function POST(request: Request) {
  const session = await requireAuth();
  await bumpSessionVersion(session.user.id);
  await recordAuditLog({
    organizationId: session.user.organizationId,
    session,
    request,
    action: "security.logout-all",
    entity: "User",
    entityId: session.user.id,
  });
  const response = NextResponse.json({ ok: true, redirect: "/login" });
  expireSignOutCookies(response.cookies);
  return response;
}
