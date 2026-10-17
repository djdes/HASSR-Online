import { NextResponse } from "next/server";

import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { verifyEquipmentQrToken } from "@/lib/equipment-qr-token";
import { FRYER_FILL_NO_DOCUMENT_ERROR, resolveFryerFillTarget } from "@/lib/equipment-fill-targets";
import { isFryerEquipmentType } from "@/lib/fryer-oil-equipment-link";
import { parseFryerQrInput, saveFryerQrEntry } from "@/lib/fryer-oil-qr";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { OBJECT_FILLER_DENIED, canFillObject } from "@/lib/object-fillers";
import { normalizeQrFillMode } from "@/lib/qr-fill-actor";
import { readObjectPassCookie, resolveObjectActor } from "@/lib/qr-object-pass";
import { QR_FILL_RATE_LIMIT_ERROR, qrFillRateKey, recordQrFillAudit } from "@/lib/qr-fill-audit";
import { qrFillRateLimiter } from "@/lib/rate-limit";
import { orgTodayKey } from "@/lib/timezone";
import { decodeRouteParam } from "@/lib/route-param";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/equipment-fill/[equipmentId]/fryer — наклейка фритюрницы
 * (2026-10-17). Тело: { token, employeeId, pin?, pass?, phase, … }.
 * `phase: "start"` — жир, продукция, оценка в начале; `phase: "end"` —
 * оценка в конце, остаток и утилизация. Строка — в журнал учёта
 * фритюрных жиров, в строку этой фритюрницы за сегодня.
 */
export async function POST(request: Request, { params }: { params: Promise<{ equipmentId: string }> }) {
  const equipmentId = decodeRouteParam((await params).equipmentId);
  if (!qrFillRateLimiter.consume(qrFillRateKey(clientIp(request), "equipment", equipmentId))) {
    return NextResponse.json({ error: QR_FILL_RATE_LIMIT_ERROR, errorCode: "equipmentFill.errors.rateLimit" }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const token = typeof body?.token === "string" ? body.token : "";
  const employeeId = typeof body?.employeeId === "string" ? body.employeeId : "";
  if (!token || !employeeId) {
    return NextResponse.json({ error: "Некорректные данные", errorCode: "equipmentFill.errors.invalidData" }, { status: 400 });
  }
  const parsed = parseFryerQrInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, errorCode: "equipmentFill.errors.invalidData" }, { status: 400 });
  }

  const verify = verifyEquipmentQrToken(token);
  if (!verify.ok || verify.equipmentId !== equipmentId) {
    return NextResponse.json({ error: "Неверная QR-наклейка", errorCode: "equipmentFill.errors.invalidSticker" }, { status: 401 });
  }
  const fryer = await db.equipment.findUnique({
    where: { id: equipmentId },
    select: {
      id: true,
      name: true,
      type: true,
      fillerUserIds: true,
      area: { select: { buildingId: true, organizationId: true, organization: { select: { timezone: true, qrFillMode: true } } } },
    },
  });
  if (!fryer || !isFryerEquipmentType(fryer.type)) {
    return NextResponse.json({ error: "Оборудование не найдено", errorCode: "equipmentFill.errors.equipmentNotFound" }, { status: 404 });
  }
  const organizationId = fryer.area.organizationId;
  const timezone = fryer.area.organization.timezone || "Europe/Moscow";
  const mode = normalizeQrFillMode(fryer.area.organization.qrFillMode);

  const actor = await resolveObjectActor({
    mode,
    organizationId,
    employeeId,
    pin: typeof body?.pin === "string" ? body.pin : null,
    pass: typeof body?.pass === "string" ? body.pass : null,
    cookiePass: await readObjectPassCookie(organizationId),
  });
  if (!actor.ok) return NextResponse.json({ error: actor.error, errorCode: actor.errorCode, errorParams: actor.errorParams }, { status: actor.status });

  // Сотрудник этой организации; «Кто заполняет» — как у остальных наклеек.
  const employee = await db.user.findFirst({
    where: { id: actor.employee.id, organizationId, ...ORG_ROSTER_WHERE },
    select: { id: true, name: true, role: true, canManageSettings: true },
  });
  if (!employee) {
    return NextResponse.json({ error: "Сотрудник не найден", errorCode: "equipmentFill.errors.employeeNotFound" }, { status: 404 });
  }
  if (!canFillObject(fryer.fillerUserIds, employee)) {
    return NextResponse.json({ error: OBJECT_FILLER_DENIED, errorCode: "equipmentFill.errors.objectDenied" }, { status: 403 });
  }

  const dayKey = orgTodayKey(timezone);
  const target = await resolveFryerFillTarget({
    equipment: { id: fryer.id, name: fryer.name, buildingId: fryer.area.buildingId },
    organizationId,
    day: new Date(`${dayKey}T00:00:00.000Z`),
  });
  if (!target) {
    return NextResponse.json(
      { code: "no-active-document", error: FRYER_FILL_NO_DOCUMENT_ERROR, errorCode: "equipmentFill.fryer.noDocument" },
      { status: 409 },
    );
  }

  const saved = await saveFryerQrEntry({
    target,
    equipment: { id: fryer.id, name: fryer.name },
    employee: { id: employee.id, name: employee.name },
    input: parsed.input,
    dayKey,
    timezone,
  });
  if (!saved.ok) return NextResponse.json({ error: saved.error, errorCode: `equipmentFill.fryer.${saved.errorCode}` }, { status: saved.status });

  await recordQrFillAudit({
    request,
    organizationId,
    kind: "equipment",
    objectId: fryer.id,
    objectName: fryer.name,
    employee: { id: employee.id, name: employee.name },
    documentIds: [target.documentId],
    dateKey: dayKey,
    authMode: mode,
    values: { fryerPhase: parsed.input.phase, quality: parsed.input.quality },
  }).catch(() => null);

  return NextResponse.json({ ok: true, phase: parsed.input.phase, time: saved.time, documentId: target.documentId });
}
