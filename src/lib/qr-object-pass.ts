import { db } from "@/lib/db";
import { verifyEquipmentQrToken } from "@/lib/equipment-qr-token";
import { normalizeQrFillMode, resolveQrFillActor, type QrFillActorResult } from "@/lib/qr-fill-actor";
import { verifyQrFillTokenFor } from "@/lib/qr-fill-token";
import { verifyQrPass } from "@/lib/qr-pin-pass";

/**
 * Наклейки объектов (холодильник, помещение, УФ-лампа) по единым правилам
 * QR (2026-09-22): PIN — отдельным шагом ДО формы, дальше пропуск визита
 * в памяти вкладки (`qr-pin-pass`, flow "any"); сохранение принимает
 * пропуск вместо PIN. Старые клиенты с `pin` в теле тоже работают.
 */
export type QrObjectKind = "equipment" | "room";

/** Токен наклейки → организация и режим QR. null — наклейка не подходит. */
export async function resolveQrObject(kind: QrObjectKind, objectId: string, token: string) {
  if (kind === "equipment") {
    const verify = verifyEquipmentQrToken(token);
    if (!verify.ok || verify.equipmentId !== objectId) return null;
    const equipment = await db.equipment.findUnique({
      where: { id: objectId },
      select: { area: { select: { organizationId: true, organization: { select: { qrFillMode: true } } } } },
    });
    if (!equipment) return null;
    return { organizationId: equipment.area.organizationId, mode: normalizeQrFillMode(equipment.area.organization.qrFillMode) };
  }
  const verify = verifyQrFillTokenFor(token, "room", objectId);
  if (!verify.ok) return null;
  const room = await db.room.findUnique({
    where: { id: objectId },
    select: { building: { select: { organizationId: true, organization: { select: { qrFillMode: true } } } } },
  });
  if (!room) return null;
  return { organizationId: room.building.organizationId, mode: normalizeQrFillMode(room.building.organization.qrFillMode) };
}

/** Кто сохраняет: по пропуску визита (PIN уже был) или по PIN в теле запроса. */
export async function resolveObjectActor(params: {
  mode: "public" | "pin" | "auth";
  organizationId: string;
  employeeId: string;
  pin?: string | null;
  pass?: string | null;
}): Promise<QrFillActorResult> {
  const passValid =
    typeof params.pass === "string" &&
    verifyQrPass(params.pass, { employeeId: params.employeeId, orgId: params.organizationId, flow: "any" });
  return resolveQrFillActor({
    mode: params.mode,
    organizationId: params.organizationId,
    employeeId: params.employeeId,
    pin: params.pin ?? null,
    pinVerified: passValid,
  });
}
