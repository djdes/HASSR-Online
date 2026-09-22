import { NextResponse } from "next/server";

import { buildingWhere } from "@/lib/building-scope";
import { clientIp } from "@/lib/client-ip";
import { CLIMATE_DOCUMENT_TEMPLATE_CODE, normalizeClimateDocumentConfig } from "@/lib/climate-document";
import { findClimateRowForRoom } from "@/lib/climate-fill";
import { COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE } from "@/lib/cold-equipment-document";
import { db } from "@/lib/db";
import { resolveEquipmentFillTargets } from "@/lib/equipment-fill-targets";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { OBJECT_FILLER_DENIED, canFillObject } from "@/lib/object-fillers";
import { QR_FILL_RATE_LIMIT_ERROR, qrFillRateKey } from "@/lib/qr-fill-audit";
import { resolveQrObject } from "@/lib/qr-object-pass";
import {
  parseQrObjectPinRequest,
  parseQrObjectPinTarget,
  qrPinRequestScreen,
  type QrObjectPinTarget,
} from "@/lib/qr-object-pin-request";
import { createQrPinRequest, latestQrPinRequestFor } from "@/lib/qr-pin-requests";
import { validatePinRequestInput } from "@/lib/qr-pin-requests-core";
import { qrFillRateLimiter } from "@/lib/rate-limit";
import { orgTodayKey } from "@/lib/timezone";
import { isUvLampType } from "@/lib/uv-lamp";
import { listLampOperators } from "@/lib/uv-lamp-runs";
import { UV_LAMP_RUNTIME_TEMPLATE_CODE, normalizeUvRuntimeDocumentConfig } from "@/lib/uv-lamp-runtime-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Запросить доступ» / «Запросить смену PIN» на наклейках объектов —
 * холодильник, склад, помещение, УФ-лампа (2026-09-22). Те же запросы
 * `QrPinRequest`, что у серверных QR-журналов: PIN придумывает сотрудник,
 * руководитель одобряет в «Сотрудниках», после этого PIN работает.
 *
 *   GET  ?kind&objectId&token&employeeId → { hasPin, status, approvedNote }
 *   POST { kind, objectId, token, employeeId, pin, pin2, requestKind } → { ok, kind, status }
 *
 * Наклейка проверяется как в `/api/qr-fill/pass`; сотрудник — из того же
 * списка, что показывает страница объекта («Кто заполняет», у лампы —
 * список журнала УФ-ламп). Сигнал уходит ответственному журнала объекта и
 * руководителям.
 */

type Place =
  | { type: "cold"; id: string; areaId: string; areaName: string; fillerUserIds: string[]; timezone: string }
  | { type: "uv"; id: string; name: string; fillerUserIds: string[]; timezone: string }
  | { type: "room"; id: string; buildingId: string; fillerUserIds: string[]; timezone: string };

const fail = (status: number, error: string) => ({ ok: false as const, response: NextResponse.json({ error }, { status }) });

async function loadPlace(target: QrObjectPinTarget): Promise<Place | null> {
  if (target.kind === "equipment") {
    const equipment = await db.equipment.findUnique({
      where: { id: target.objectId },
      select: {
        id: true,
        name: true,
        type: true,
        fillerUserIds: true,
        area: { select: { id: true, name: true, organization: { select: { timezone: true } } } },
      },
    });
    if (!equipment) return null;
    const timezone = equipment.area.organization.timezone || "Europe/Moscow";
    return isUvLampType(equipment.type)
      ? { type: "uv", id: equipment.id, name: equipment.name, fillerUserIds: equipment.fillerUserIds, timezone }
      : { type: "cold", id: equipment.id, areaId: equipment.area.id, areaName: equipment.area.name, fillerUserIds: equipment.fillerUserIds, timezone };
  }
  const room = await db.room.findUnique({
    where: { id: target.objectId },
    select: { id: true, buildingId: true, fillerUserIds: true, building: { select: { organization: { select: { timezone: true } } } } },
  });
  if (!room) return null;
  return { type: "room", id: room.id, buildingId: room.buildingId, fillerUserIds: room.fillerUserIds, timezone: room.building.organization.timezone || "Europe/Moscow" };
}

/** Наклейка → организация, сотрудник из списка объекта. Вход через кабинет — без PIN, запрашивать нечего. */
async function resolveRequester(target: QrObjectPinTarget) {
  const object = await resolveQrObject(target.kind, target.objectId, target.token);
  if (!object) return fail(401, "QR-наклейка не подходит");
  if (object.mode === "auth") return fail(409, "Здесь входят через кабинет — PIN не нужен.");
  const [employee, place] = await Promise.all([
    db.user.findFirst({
      where: { id: target.employeeId, organizationId: object.organizationId, ...ORG_ROSTER_WHERE },
      select: { id: true, role: true, canManageSettings: true, qrPinHash: true },
    }),
    loadPlace(target),
  ]);
  if (!employee) return fail(404, "Сотрудник не найден");
  if (!place) return fail(404, "Объект не найден");
  const allowed =
    place.type === "uv"
      ? (await listLampOperators({ organizationId: object.organizationId, fillerUserIds: place.fillerUserIds, documentResponsibleId: null })).some(
          (operator) => operator.id === employee.id
        )
      : canFillObject(place.fillerUserIds, employee);
  if (!allowed) return fail(403, OBJECT_FILLER_DENIED);
  return { ok: true as const, organizationId: object.organizationId, employee: { id: employee.id, hasPin: Boolean(employee.qrPinHash) }, place };
}

/** Журнал объекта на сегодня — его ответственный получит сигнал вместе с руководителями. Только поиск, без создания. */
async function journalFor(place: Place, organizationId: string): Promise<{ journalCode: string; documentId: string | null }> {
  const day = new Date(`${orgTodayKey(place.timezone)}T00:00:00.000Z`);
  if (place.type === "cold") {
    const targets = await resolveEquipmentFillTargets({ equipment: { id: place.id, areaId: place.areaId, areaName: place.areaName }, organizationId, day });
    if (targets.coldDocuments[0]) return { journalCode: COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE, documentId: targets.coldDocuments[0].id };
    if (targets.climate) return { journalCode: CLIMATE_DOCUMENT_TEMPLATE_CODE, documentId: targets.climate.documentId };
    return { journalCode: COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE, documentId: null };
  }
  if (place.type === "room") {
    // Тот же выбор документа, что у страницы помещения.
    const documents = await db.journalDocument.findMany({
      where: {
        organizationId,
        status: "active",
        template: { code: CLIMATE_DOCUMENT_TEMPLATE_CODE },
        dateFrom: { lte: day },
        dateTo: { gte: day },
        ...buildingWhere(place.buildingId),
      },
      select: { id: true, config: true, buildingId: true },
      orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
    });
    const document =
      documents.find((doc) => findClimateRowForRoom(normalizeClimateDocumentConfig(doc.config), place.id)) ??
      documents.find((doc) => doc.buildingId === place.buildingId) ??
      documents[0] ??
      null;
    return { journalCode: CLIMATE_DOCUMENT_TEMPLATE_CODE, documentId: document?.id ?? null };
  }
  // УФ-лампа: документ журнала этой лампы — связанный или по номеру лампы.
  const documents = await db.journalDocument.findMany({
    where: { organizationId, status: "active", template: { code: UV_LAMP_RUNTIME_TEMPLATE_CODE }, dateFrom: { lte: day }, dateTo: { gte: day } },
    select: { id: true, config: true },
    orderBy: { dateFrom: "desc" },
  });
  const lampName = place.name.trim().toLowerCase();
  const configs = documents.map((doc) => ({ id: doc.id, config: normalizeUvRuntimeDocumentConfig(doc.config) }));
  const document =
    configs.find((doc) => doc.config.equipmentId === place.id) ??
    configs.find((doc) => !doc.config.equipmentId && doc.config.lampNumber.trim().toLowerCase() === lampName) ??
    null;
  return { journalCode: UV_LAMP_RUNTIME_TEMPLATE_CODE, documentId: document?.id ?? null };
}

/** Есть ли у сотрудника PIN и что с его последним запросом — строка статуса на экране. */
export async function GET(request: Request) {
  const target = parseQrObjectPinTarget(Object.fromEntries(new URL(request.url).searchParams));
  if (!target) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  // Свой счётчик: проверка статуса не съедает лимит записей и PIN.
  if (!qrFillRateLimiter.consume(`${qrFillRateKey(clientIp(request), target.kind, target.objectId)}:pin-status`)) {
    return NextResponse.json({ error: QR_FILL_RATE_LIMIT_ERROR }, { status: 429 });
  }
  const requester = await resolveRequester(target);
  if (!requester.ok) return requester.response;
  const latest = await latestQrPinRequestFor({ organizationId: requester.organizationId, userId: requester.employee.id });
  return NextResponse.json(
    { hasPin: requester.employee.hasPin, ...qrPinRequestScreen(latest) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const input = parseQrObjectPinRequest(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  if (!qrFillRateLimiter.consume(qrFillRateKey(clientIp(request), input.kind, input.objectId))) {
    return NextResponse.json({ error: QR_FILL_RATE_LIMIT_ERROR }, { status: 429 });
  }
  const requester = await resolveRequester(input);
  if (!requester.ok) return requester.response;
  const invalid = validatePinRequestInput({ pin: input.pin, repeat: input.pin2 });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const journal = await journalFor(requester.place, requester.organizationId);
  const created = await createQrPinRequest({
    organizationId: requester.organizationId,
    userId: requester.employee.id,
    kind: input.requestKind,
    pin: input.pin,
    repeat: input.pin2,
    source: input.kind === "room" ? "room-fill" : "equipment-fill",
    journalCode: journal.journalCode,
    documentId: journal.documentId,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });
  return NextResponse.json({ ok: true, kind: input.requestKind, status: qrPinRequestScreen({ kind: input.requestKind, status: "pending" }).status });
}
