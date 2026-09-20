import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/client-ip";
import { resolveKioskContext } from "@/lib/kiosk-context";
import { resolveQrFillActor } from "@/lib/qr-fill-actor";
import { issueKioskSession } from "@/lib/issue-session";
import { qrFillRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/kiosk/unlock — сотрудник подтверждает личность ПИН.
 *
 * Проверяем ПИН существующим `resolveQrFillActor` (bcrypt, блок при
 * подборе), выдаём короткую киоск-сессию с `lockAt` и пишем `SignatureEvent`
 * — первичное доказательство «кто открыл этот планшет и когда». Дальше все
 * записи журналов уходят уже от имени этого сотрудника.
 */
const Schema = z.object({
  userId: z.string().min(1),
  pin: z.string().min(1).max(12),
});

export async function POST(request: Request) {
  const ctx = await resolveKioskContext();
  if (!ctx) {
    return NextResponse.json({ error: "Планшет не привязан" }, { status: 401 });
  }

  if (!qrFillRateLimiter.consume(`kiosk:${ctx.device.id}:${clientIp(request) ?? "unknown"}`)) {
    return NextResponse.json({ error: "Слишком много попыток. Подождите минуту." }, { status: 429 });
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Bad input" }, { status: 400 });
    }
    throw err;
  }

  const actor = await resolveQrFillActor({
    mode: "pin",
    organizationId: ctx.device.organizationId,
    employeeId: body.userId,
    pin: body.pin,
  });
  if (!actor.ok) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  const user = await db.user.findFirst({
    where: { id: actor.employee.id, organizationId: ctx.device.organizationId },
    select: { id: true, email: true, name: true, role: true, isRoot: true, permissionPreset: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  const lockAt = Date.now() + ctx.organization.kioskIdleLockSeconds * 1000;
  const response = NextResponse.json({ ok: true, user: { id: user.id, name: user.name }, lockAt });
  await issueKioskSession(
    response,
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: ctx.device.organizationId,
      isRoot: user.isRoot,
      permissionPreset: user.permissionPreset,
    },
    ctx.organization.name,
    { deviceId: ctx.device.id, lockAt },
  );

  await db.signatureEvent.create({
    data: {
      organizationId: ctx.device.organizationId,
      userId: user.id,
      method: "kiosk_pin",
      deviceId: ctx.device.id,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
    },
  });
  await db.kioskDevice.update({ where: { id: ctx.device.id }, data: { lastSeenAt: new Date() } });

  return response;
}
