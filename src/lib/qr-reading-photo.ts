import { headers } from "next/headers";

import { db } from "@/lib/db";
import { verifyEquipmentQrToken } from "@/lib/equipment-qr-token";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { isMobileAppUserAgent } from "@/lib/mobile-app";
import { OBJECT_FILLER_DENIED, canFillObject } from "@/lib/object-fillers";
import { hasPaidPlan } from "@/lib/plan-limits.server";
import { normalizeQrFillMode } from "@/lib/qr-fill-actor";
import { verifyQrFillTokenFor } from "@/lib/qr-fill-token";
import { readObjectPassCookie, resolveObjectActor, type QrObjectKind } from "@/lib/qr-object-pass";
import { TARIFFS_HREF } from "@/lib/reading-photos";
import { isManagementRole } from "@/lib/user-roles";

/**
 * Кто и куда шлёт фото к замеру с QR-наклейки холодильника или плаката
 * склада (`/api/qr-fill/reading-photo`). Сессии нет — те же проверки, что у
 * сохранения замера: подпись наклейки → организация и режим QR → сотрудник
 * (PIN / пропуск / вход в кабинет) → «Кто заполняет» объект.
 *
 * Здесь же — тариф организации: автоввод с фото только на платном; ссылку
 * на тарифы видит руководитель (страница тарифов — только для руководства),
 * и только не в приложении WeSetup.
 */

export type QrReadingPhotoActor = {
  organizationId: string;
  objectName: string;
  employee: { id: string; name: string; role: string | null };
  /** Платный тариф: показание со снимка распознаётся и подставляется. */
  autofill: boolean;
  /** Ссылка на тарифы — руководителю на бесплатном тарифе; сотруднику — нет. */
  tariffsHref: string | null;
};

/**
 * Ссылка на тарифы в подсказке «автоввод только на платном тарифе».
 * Есть только на бесплатном тарифе и только у того, кто может открыть
 * страницу тарифов. В приложении WeSetup ссылки нет никогда: правила
 * App Store и Google Play запрещают вести к оплате вне магазина.
 */
export function readingTariffsHref(input: {
  autofill: boolean;
  mayOpenTariffs: boolean;
  userAgent: string | null | undefined;
}): string | null {
  if (input.autofill || !input.mayOpenTariffs) return null;
  if (isMobileAppUserAgent(input.userAgent)) return null;
  return TARIFFS_HREF;
}

export type QrReadingPhotoAuth =
  | { ok: true; actor: QrReadingPhotoActor }
  | { ok: false; status: number; error: string };

async function loadObject(kind: QrObjectKind, objectId: string, token: string) {
  if (kind === "equipment") {
    const verify = verifyEquipmentQrToken(token);
    if (!verify.ok || verify.equipmentId !== objectId) return null;
    const equipment = await db.equipment.findUnique({
      where: { id: objectId },
      select: {
        name: true,
        fillerUserIds: true,
        area: { select: { organizationId: true, organization: { select: { qrFillMode: true } } } },
      },
    });
    if (!equipment) return null;
    return {
      organizationId: equipment.area.organizationId,
      mode: normalizeQrFillMode(equipment.area.organization.qrFillMode),
      name: equipment.name,
      fillerUserIds: equipment.fillerUserIds,
    };
  }
  const verify = verifyQrFillTokenFor(token, "room", objectId);
  if (!verify.ok) return null;
  const room = await db.room.findUnique({
    where: { id: objectId },
    select: {
      name: true,
      fillerUserIds: true,
      building: { select: { organizationId: true, organization: { select: { qrFillMode: true } } } },
    },
  });
  if (!room) return null;
  return {
    organizationId: room.building.organizationId,
    mode: normalizeQrFillMode(room.building.organization.qrFillMode),
    name: room.name,
    fillerUserIds: room.fillerUserIds,
  };
}

export async function authorizeQrReadingPhoto(input: {
  kind: QrObjectKind;
  objectId: string;
  token: string;
  employeeId: string;
  pin?: string | null;
  pass?: string | null;
  /** User-Agent запроса; не передан — берём из заголовков текущего запроса. */
  userAgent?: string | null;
}): Promise<QrReadingPhotoAuth> {
  const object = await loadObject(input.kind, input.objectId, input.token);
  if (!object) return { ok: false, status: 401, error: "QR-наклейка не подходит" };

  const actor = await resolveObjectActor({
    mode: object.mode,
    organizationId: object.organizationId,
    employeeId: input.employeeId,
    pin: input.pin,
    pass: input.pass,
    cookiePass: await readObjectPassCookie(object.organizationId),
  });
  if (!actor.ok) return { ok: false, status: actor.status, error: actor.error };

  const employee = await db.user.findFirst({
    where: { id: input.employeeId, organizationId: object.organizationId, ...ORG_ROSTER_WHERE },
    select: { id: true, name: true, role: true, canManageSettings: true },
  });
  if (!employee) return { ok: false, status: 404, error: "Сотрудник не найден" };
  if (!canFillObject(object.fillerUserIds, employee)) return { ok: false, status: 403, error: OBJECT_FILLER_DENIED };

  const autofill = await hasPaidPlan(object.organizationId);
  const userAgent =
    input.userAgent !== undefined ? input.userAgent : (await headers()).get("user-agent");
  return {
    ok: true,
    actor: {
      organizationId: object.organizationId,
      objectName: object.name,
      employee: { id: employee.id, name: employee.name, role: employee.role },
      autofill,
      tariffsHref: readingTariffsHref({
        autofill,
        mayOpenTariffs: isManagementRole(employee.role),
        userAgent,
      }),
    },
  };
}
