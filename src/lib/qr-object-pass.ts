import { cookies } from "next/headers";

import { db } from "@/lib/db";
import { verifyEquipmentQrToken } from "@/lib/equipment-qr-token";
import { normalizeQrFillMode, resolveQrFillActor, type QrFillActorResult } from "@/lib/qr-fill-actor";
import { verifyQrFillTokenFor } from "@/lib/qr-fill-token";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { qrPassCookieName, qrPinFingerprint, readQrPass, verifyQrPass } from "@/lib/qr-pin-pass";

/**
 * Наклейки объектов (холодильник, помещение, УФ-лампа) по единым правилам
 * QR (2026-09-22): PIN — отдельным шагом ДО формы, дальше пропуск
 * (`qr-pin-pass`, flow "any"); сохранение принимает пропуск вместо PIN.
 * Старые клиенты с `pin` в теле тоже работают.
 *
 * С 2026-09-23 пропуск ещё и в cookie организации на 30 минут («Запомнить
 * выбор» включено): F5 и соседняя наклейка той же организации — без PIN.
 * Пропуск действует, только пока у сотрудника тот же PIN (отпечаток) и он
 * не заблокирован после 5 ошибок.
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

/** Текущий отпечаток PIN сотрудника организации; null — нет PIN, заблокирован или не из списка. */
async function livePinFingerprint(organizationId: string, employeeId: string): Promise<string | null> {
  const user = await db.user.findFirst({
    where: { id: employeeId, organizationId, ...ORG_ROSTER_WHERE },
    select: { qrPinHash: true, qrPinLockedUntil: true },
  });
  if (!user?.qrPinHash) return null;
  if (user.qrPinLockedUntil && user.qrPinLockedUntil.getTime() > Date.now()) return null;
  return qrPinFingerprint(user.qrPinHash);
}

/** Пропуск (из тела или cookie) действует для этого сотрудника прямо сейчас. */
export async function isObjectPassValid(params: { organizationId: string; employeeId: string; pass: string | null | undefined }): Promise<boolean> {
  if (!params.pass) return false;
  const claimed = readQrPass(params.organizationId, params.pass);
  if (!claimed || claimed.employeeId !== params.employeeId) return false;
  const pinFp = await livePinFingerprint(params.organizationId, params.employeeId);
  return pinFp !== null && verifyQrPass(params.pass, { employeeId: params.employeeId, orgId: params.organizationId, flow: "any", pinFp });
}

/** Сырое значение cookie пропуска организации (серверные страницы и API). */
export async function readObjectPassCookie(organizationId: string): Promise<string | null> {
  return (await cookies()).get(qrPassCookieName(organizationId))?.value ?? null;
}

/**
 * Для страницы наклейки: чей пропуск лежит в cookie (null — нет или погас).
 * Клиент пропускает шаг PIN, если выбран этот же сотрудник.
 */
export async function passEmployeeIdFromCookie(organizationId: string): Promise<string | null> {
  const value = await readObjectPassCookie(organizationId);
  const claimed = readQrPass(organizationId, value);
  if (!claimed) return null;
  return (await isObjectPassValid({ organizationId, employeeId: claimed.employeeId, pass: value })) ? claimed.employeeId : null;
}

/**
 * Кто сохраняет: по пропуску (PIN уже был) — из тела запроса или cookie
 * организации, — иначе по PIN в теле запроса.
 */
export async function resolveObjectActor(params: {
  mode: "public" | "pin" | "auth";
  organizationId: string;
  employeeId: string;
  pin?: string | null;
  pass?: string | null;
  /** Пропуск из cookie `wesetup.qr.pass.<orgId>` (`readObjectPassCookie`). */
  cookiePass?: string | null;
}): Promise<QrFillActorResult> {
  const passValid =
    params.mode !== "auth" &&
    ((await isObjectPassValid({ organizationId: params.organizationId, employeeId: params.employeeId, pass: params.pass })) ||
      (await isObjectPassValid({ organizationId: params.organizationId, employeeId: params.employeeId, pass: params.cookiePass })));
  return resolveQrFillActor({
    mode: params.mode,
    organizationId: params.organizationId,
    employeeId: params.employeeId,
    pin: params.pin ?? null,
    pinVerified: passValid,
  });
}
