import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  KIOSK_DEVICE_COOKIE,
  verifyKioskDeviceToken,
} from "@/lib/kiosk-device";

/**
 * Разбор device-cookie общего планшета в живое устройство.
 *
 * Возвращает активный (не отозванный) `KioskDevice` его организации — по
 * этому контексту роуты киоска отдают список сотрудников и принимают ПИН.
 * Сам по себе доступа к данным не даёт: запись делает короткая сессия
 * сотрудника, выданная после проверки ПИН.
 */
export type KioskContext = {
  device: {
    id: string;
    organizationId: string;
    buildingId: string | null;
    label: string;
  };
  organization: { id: string; name: string; kioskIdleLockSeconds: number; kioskPhotoRequired: boolean };
};

export async function resolveKioskContext(): Promise<KioskContext | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(KIOSK_DEVICE_COOKIE)?.value;
  const verify = verifyKioskDeviceToken(raw);
  if (!verify.ok) return null;

  const device = await db.kioskDevice.findFirst({
    where: { id: verify.deviceId, revokedAt: null },
    select: {
      id: true,
      organizationId: true,
      buildingId: true,
      label: true,
      organization: {
        select: { id: true, name: true, kioskIdleLockSeconds: true, kioskEnabled: true, kioskPhotoRequired: true },
      },
    },
  });
  if (!device || !device.organization.kioskEnabled) return null;

  return {
    device: {
      id: device.id,
      organizationId: device.organizationId,
      buildingId: device.buildingId,
      label: device.label,
    },
    organization: {
      id: device.organization.id,
      name: device.organization.name,
      kioskIdleLockSeconds: device.organization.kioskIdleLockSeconds,
      kioskPhotoRequired: device.organization.kioskPhotoRequired,
    },
  };
}
