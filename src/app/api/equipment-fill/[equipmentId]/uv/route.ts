import { NextResponse } from "next/server";

import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { verifyEquipmentQrToken } from "@/lib/equipment-qr-token";
import { OBJECT_FILLER_DENIED } from "@/lib/object-fillers";
import { normalizeQrFillMode } from "@/lib/qr-fill-actor";
import { readObjectPassCookie, resolveObjectActor } from "@/lib/qr-object-pass";
import { QR_FILL_RATE_LIMIT_ERROR, qrFillRateKey, recordQrFillAudit } from "@/lib/qr-fill-audit";
import { qrFillRateLimiter } from "@/lib/rate-limit";
import { orgTodayKey } from "@/lib/timezone";
import { isUvLampType } from "@/lib/uv-lamp";
import { ensureUvDocumentForLamp, lampState, listLampOperators, toggleLamp } from "@/lib/uv-lamp-runs";
import { isManagementRole } from "@/lib/user-roles";
import { decodeRouteParam } from "@/lib/route-param";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/equipment-fill/[equipmentId]/uv — наклейка УФ-лампы (2026-09-22).
 * Тело: { token, employeeId, pin?, action: "on" | "off" }. «Я включил» /
 * «Я выключил»: сеанс в журнал учёта работы лампы, наработка у лампы.
 */
export async function POST(request: Request, { params }: { params: Promise<{ equipmentId: string }> }) {
  const equipmentId = decodeRouteParam((await params).equipmentId);
  if (!qrFillRateLimiter.consume(qrFillRateKey(clientIp(request), "equipment", equipmentId))) {
    return NextResponse.json({ error: QR_FILL_RATE_LIMIT_ERROR }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as
    | { token?: unknown; employeeId?: unknown; pin?: unknown; pass?: unknown; action?: unknown }
    | null;
  const token = typeof body?.token === "string" ? body.token : "";
  const employeeId = typeof body?.employeeId === "string" ? body.employeeId : "";
  const action = body?.action === "on" || body?.action === "off" ? body.action : null;
  if (!token || !employeeId || !action) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });

  const verify = verifyEquipmentQrToken(token);
  if (!verify.ok || verify.equipmentId !== equipmentId) {
    return NextResponse.json({ error: "Неверная QR-наклейка" }, { status: 401 });
  }
  const lamp = await db.equipment.findUnique({
    where: { id: equipmentId },
    select: {
      id: true,
      name: true,
      type: true,
      fillerUserIds: true,
      lampLifetimeHours: true,
      area: { select: { name: true, organizationId: true, organization: { select: { timezone: true, qrFillMode: true } } } },
    },
  });
  if (!lamp || !isUvLampType(lamp.type)) return NextResponse.json({ error: "Это не УФ-лампа" }, { status: 404 });
  const organizationId = lamp.area.organizationId;
  const timeZone = lamp.area.organization.timezone || "Europe/Moscow";
  const mode = normalizeQrFillMode(lamp.area.organization.qrFillMode);

  const actor = await resolveObjectActor({
    mode,
    organizationId,
    employeeId,
    pin: typeof body?.pin === "string" ? body.pin : null,
    pass: typeof body?.pass === "string" ? body.pass : null,
    cookiePass: await readObjectPassCookie(organizationId),
  });
  if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: actor.status });

  // Только люди из списка журнала (закреплённые за лампой / ответственные журнала).
  const doc = await ensureUvDocumentForLamp({
    organizationId,
    lamp: { id: lamp.id, name: lamp.name, areaName: lamp.area.name, lampLifetimeHours: lamp.lampLifetimeHours },
    todayKey: orgTodayKey(timeZone),
  });
  const operators = await listLampOperators({ organizationId, fillerUserIds: lamp.fillerUserIds, documentResponsibleId: doc?.responsibleUserId ?? null });
  const person = await db.user.findUnique({ where: { id: actor.employee.id }, select: { role: true, canManageSettings: true } });
  const allowed =
    operators.some((operator) => operator.id === actor.employee.id) || isManagementRole(person?.role ?? "") || person?.canManageSettings === true;
  if (!allowed) return NextResponse.json({ error: OBJECT_FILLER_DENIED }, { status: 403 });

  const result = await toggleLamp({
    organizationId,
    timeZone,
    lamp: { id: lamp.id, name: lamp.name, areaName: lamp.area.name },
    employee: { id: actor.employee.id, name: actor.employee.name },
    action,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await recordQrFillAudit({
    request,
    organizationId,
    kind: "equipment",
    objectId: lamp.id,
    objectName: lamp.name,
    employee: { id: actor.employee.id, name: actor.employee.name },
    documentIds: doc ? [doc.id] : [],
    dateKey: orgTodayKey(timeZone),
    authMode: mode,
    values: { uvAction: action, ...(result.action === "off" ? { hours: result.hours } : {}) },
  }).catch(() => null);

  return NextResponse.json({ ...result, state: await lampState(lamp.id, timeZone) });
}
