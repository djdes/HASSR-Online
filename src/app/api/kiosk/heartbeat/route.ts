import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { resolveKioskContext } from "@/lib/kiosk-context";
import { issueKioskSession } from "@/lib/issue-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/kiosk/heartbeat — продлить окно активности киоск-сессии.
 *
 * Пока сотрудник работает, клиент периодически дёргает этот роут: сессия
 * переиздаётся с новым `lockAt`. Если сессия уже заблокирована по idle,
 * `getServerSession` вернёт null — продлевать нечего, отвечаем 401, и
 * клиент уводит на список сотрудников.
 */
export async function POST() {
  const ctx = await resolveKioskContext();
  if (!ctx) return NextResponse.json({ error: "Планшет не привязан" }, { status: 401 });

  const session = await getServerSession(authOptions);
  if (!session || session.user.organizationId !== ctx.device.organizationId) {
    return NextResponse.json({ locked: true }, { status: 401 });
  }

  const lockAt = Date.now() + ctx.organization.kioskIdleLockSeconds * 1000;
  const response = NextResponse.json({ ok: true, lockAt });
  await issueKioskSession(
    response,
    {
      id: session.user.id,
      email: session.user.email ?? "",
      name: session.user.name ?? "",
      role: session.user.role,
      organizationId: ctx.device.organizationId,
      isRoot: session.user.isRoot,
      permissionPreset: session.user.permissionPreset,
    },
    ctx.organization.name,
    { deviceId: ctx.device.id, lockAt },
  );
  return response;
}
