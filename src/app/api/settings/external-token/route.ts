import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiRole } from "@/lib/auth-helpers";
import { COMPANY_ONLY_API_ERROR, isPointScoped } from "@/lib/point-scope";
import type { Session } from "next-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ключ пишет в журналы любой точки и ведёт кадры всей организации
 * (аудит 2026-11-01): руководителю точки он не выдаётся (proxy закрывает
 * ему только изменения), партнёру в кабинете клиента — тоже, как ключи
 * REST v1 (`keyAdminGuard`): ключ пережил бы отключение консультанта.
 */
function tokenDenied(session: Session): NextResponse | null {
  if (isPointScoped(session.user)) {
    return NextResponse.json({ error: COMPANY_ONLY_API_ERROR }, { status: 403 });
  }
  if (session.user.partnerAccess) {
    return NextResponse.json({ error: "Ключ внешнего API выдаёт сам руководитель организации" }, { status: 403 });
  }
  return null;
}

/**
 * Returns the current organisation's external API token (or null if
 * unset). Owner/manager only.
 */
export async function GET() {
  const auth = await requireApiRole(["owner", "manager", "technologist", "head_chef"]);
  if (!auth.ok) return auth.response;
  const session = auth.session;
  const denied = tokenDenied(session);
  if (denied) return denied;
  const org = await db.organization.findUnique({
    where: { id: getActiveOrgId(session) },
    select: { externalApiToken: true },
  });
  return NextResponse.json({ token: org?.externalApiToken ?? null });
}

/**
 * Rotates the organisation's external API token. Call POST to generate a
 * fresh 32-byte hex key; this invalidates any prior key. DELETE unsets it,
 * falling back to the shared EXTERNAL_API_TOKEN env for backwards-compat.
 */
export async function POST() {
  const auth = await requireApiRole(["owner", "manager"]);
  if (!auth.ok) return auth.response;
  const session = auth.session;
  const denied = tokenDenied(session);
  if (denied) return denied;
  const token = crypto.randomBytes(32).toString("hex");
  await db.organization.update({
    where: { id: getActiveOrgId(session) },
    data: { externalApiToken: token },
  });
  return NextResponse.json({ token });
}

export async function DELETE() {
  const auth = await requireApiRole(["owner", "manager"]);
  if (!auth.ok) return auth.response;
  const session = auth.session;
  const denied = tokenDenied(session);
  if (denied) return denied;
  await db.organization.update({
    where: { id: getActiveOrgId(session) },
    data: { externalApiToken: null },
  });
  return NextResponse.json({ token: null });
}
