import { NextResponse } from "next/server";

import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { issueSession } from "@/lib/issue-session";
import { resolvePersonalLoginToken } from "@/lib/personal-login";
import { resolveQrFillActor } from "@/lib/qr-fill-actor";
import { qrFillRateLimiter } from "@/lib/rate-limit";
import { getPermissionRole } from "@/lib/user-roles";
import { recordAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/q/login — вход по личному QR (2026-09-22). Тело: { token, pin }.
 * Токен из QR + свой PIN (блокировка после 5 ошибок, как на QR-формах) →
 * обычная сессия кабинета.
 */
export async function POST(request: Request) {
  if (!qrFillRateLimiter.consume(`personal-login:${clientIp(request) ?? "unknown"}`)) {
    return NextResponse.json({ error: "Слишком много попыток. Подождите минуту." }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as { token?: unknown; pin?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
  const resolved = token ? await resolvePersonalLoginToken(token) : null;
  if (!resolved) {
    return NextResponse.json({ error: "QR больше не действует — попросите руководителя выпустить новый." }, { status: 404 });
  }
  const { user } = resolved;
  if (!user.qrPinHash) {
    return NextResponse.json({ error: "У вас ещё нет PIN — попросите руководителя выдать его в карточке сотрудника." }, { status: 403 });
  }
  const actor = await resolveQrFillActor({ mode: "pin", organizationId: user.organizationId, employeeId: user.id, pin, includeCommission: true });
  if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: actor.status });

  await db.personalLoginToken.update({ where: { id: resolved.tokenId }, data: { lastUsedAt: new Date() } }).catch(() => null);
  await recordAuditLog({
    request,
    session: { user: { id: user.id, name: user.name } },
    organizationId: user.organizationId,
    action: "auth.personal_qr_login",
    entity: "user",
    entityId: user.id,
    details: { method: "personal-qr+pin" },
  }).catch(() => null);

  const response = NextResponse.json({ ok: true, redirect: "/dashboard" });
  return issueSession(
    response,
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: getPermissionRole(user.role),
      organizationId: user.organizationId,
      isRoot: user.isRoot,
      permissionPreset: user.permissionPreset,
    },
    user.organization.name
  );
}
