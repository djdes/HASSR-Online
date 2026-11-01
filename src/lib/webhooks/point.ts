import { db } from "@/lib/db";

/**
 * Точка события для исходящих вебхуков (2026-11-01): `buildingId` и
 * название точки — получатель (учётная система сети) раскладывает события
 * по точкам. Точка документа, иначе точка цеха оборудования; нет точки —
 * null. Зовётся лениво, только когда у организации есть подписки.
 */
export async function webhookPointFields(
  organizationId: string,
  source: { documentId?: string | null; equipmentId?: string | null },
): Promise<{ buildingId: string | null; buildingName: string | null }> {
  let buildingId: string | null = null;
  if (source.documentId) {
    const doc = await db.journalDocument.findFirst({
      where: { id: source.documentId, organizationId },
      select: { buildingId: true },
    });
    buildingId = doc?.buildingId ?? null;
  }
  if (!buildingId && source.equipmentId) {
    const equipment = await db.equipment.findFirst({
      where: { id: source.equipmentId, area: { organizationId } },
      select: { area: { select: { buildingId: true } } },
    });
    buildingId = equipment?.area.buildingId ?? null;
  }
  if (!buildingId) return { buildingId: null, buildingName: null };
  const building = await db.building.findFirst({
    where: { id: buildingId, organizationId },
    select: { name: true },
  });
  return { buildingId, buildingName: building?.name ?? null };
}
