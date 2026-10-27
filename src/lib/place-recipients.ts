import { db } from "@/lib/db";
import { receivesPlaceEvent, splitsOfficeAndPoints, type BuildingKindRef } from "@/lib/building-scope";

/**
 * Уведомления по месту (фаза 3 «Офис и точки», 2026-10-27): из получателей
 * события оставляем тех, кому оно по месту, — `receivesPlaceEvent`.
 * Событие точки (`buildingId`) — людям этой точки и офису, общее — офису;
 * в организации без офиса — как раньше.
 */
export async function filterRecipientsByPlace<T extends { buildingIds: string[] }>(
  organizationId: string,
  users: T[],
  buildingId?: string | null,
  /** Только люди самой точки — офис получает сводку отдельно. */
  onlyPlace = false,
): Promise<T[]> {
  if (users.length === 0) return users;
  const place = await loadPlaceContext(organizationId);
  if (!place) return users;
  return users.filter((user) =>
    receivesPlaceEvent({ ...place, userBuildingIds: user.buildingIds, buildingId, onlyPlace }),
  );
}

export type PlaceContext = { enabled: boolean; buildings: BuildingKindRef[]; split: boolean };

/** Точки организации для правил «кому по месту»; null — организации нет. */
export async function loadPlaceContext(organizationId: string): Promise<PlaceContext | null> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { perLocationJournals: true, buildings: { select: { id: true, kind: true } } },
  });
  if (!org) return null;
  const context = { enabled: org.perLocationJournals, buildings: org.buildings };
  return { ...context, split: splitsOfficeAndPoints(context) };
}

/**
 * Точка события: оборудование (стоит в помещении на точке), помещение,
 * документ журнала или сотрудник, работающий на одной точке, — что
 * известно, в этом порядке. Нет привязки — null (общее событие).
 */
export async function placeOfEvent(
  organizationId: string,
  ref: { areaId?: string | null; equipmentId?: string | null; documentId?: string | null; userId?: string | null },
): Promise<string | null> {
  if (ref.equipmentId) {
    const equipment = await db.equipment.findFirst({
      where: { id: ref.equipmentId, area: { organizationId } },
      select: { area: { select: { buildingId: true } } },
    });
    if (equipment?.area.buildingId) return equipment.area.buildingId;
  }
  if (ref.areaId) {
    const area = await db.area.findFirst({
      where: { id: ref.areaId, organizationId },
      select: { buildingId: true },
    });
    if (area?.buildingId) return area.buildingId;
  }
  if (ref.documentId) {
    const document = await db.journalDocument.findFirst({
      where: { id: ref.documentId, organizationId },
      select: { buildingId: true },
    });
    if (document?.buildingId) return document.buildingId;
  }
  if (ref.userId) {
    const user = await db.user.findFirst({
      where: { id: ref.userId, organizationId },
      select: { buildingIds: true },
    });
    if (user?.buildingIds.length === 1) return user.buildingIds[0];
  }
  return null;
}
