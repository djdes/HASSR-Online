import { db } from "@/lib/db";
import type { ColdEquipmentConfigItem } from "@/lib/cold-equipment-document";

/**
 * Синк строки холодильного журнала со справочником «Оборудование».
 *
 * Строка документа (`config.equipment[i]`) и запись `Equipment` — одно и то
 * же устройство. QR-заполнение, IoT и CAPA ищут строку по
 * `sourceEquipmentId`, поэтому каждая сохранённая из журнала строка
 * ОБЯЗАНА иметь запись в справочнике: связанную обновляем, несвязанную —
 * создаём и связываем (решение владельца, 2026-09-18).
 *
 * Server-only: импортирует `@/lib/db`.
 */

export const DEFAULT_AREA_NAME = "Основной цех";

/**
 * `Equipment.areaId` обязателен: первый цех организации или новый «Основной
 * цех». Для документа точки (`pointId`) — первый цех этой точки или новый
 * «Основной цех» на ней (2026-10-31): холодильник, добавленный в журнале
 * точки А, раньше попадал в первый по алфавиту цех — часто точки Б.
 */
export async function ensureDefaultArea(organizationId: string, pointId: string | null = null): Promise<string> {
  if (pointId) {
    const own = await db.area.findFirst({
      where: { organizationId, buildingId: pointId },
      orderBy: { name: "asc" },
      select: { id: true },
    });
    if (own) return own.id;
    const created = await db.area.create({
      data: { organizationId, name: DEFAULT_AREA_NAME, buildingId: pointId },
      select: { id: true },
    });
    return created.id;
  }
  const existing = await db.area.findFirst({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  // Точка одна — цех сразу её (2026-10-17, «точка → помещения → оборудование»).
  const buildings = await db.building.findMany({
    where: { organizationId },
    select: { id: true },
    take: 2,
  });
  const created = await db.area.create({
    data: {
      organizationId,
      name: DEFAULT_AREA_NAME,
      buildingId: buildings.length === 1 ? buildings[0].id : null,
    },
    select: { id: true },
  });
  return created.id;
}

/** Морозильное — если верхняя граница нормы не выше −6 °C; иначе холодильное. */
export function guessEquipmentType(item: Pick<ColdEquipmentConfigItem, "min" | "max">): string {
  return item.max != null && item.max <= -6 ? "freezer" : "refrigerator";
}

/**
 * Обновляет запись справочника или создаёт её. Возвращает строку с
 * заполненным `sourceEquipmentId`. `pointId` — точка документа: новая запись
 * встаёт в её цех.
 */
export async function syncEquipmentDirectoryItem(
  organizationId: string,
  item: ColdEquipmentConfigItem,
  pointId: string | null = null,
): Promise<ColdEquipmentConfigItem> {
  const name = item.name.trim().slice(0, 200);
  if (item.sourceEquipmentId) {
    const linked = await db.equipment.findFirst({
      where: { id: item.sourceEquipmentId, area: { organizationId } },
      select: { id: true },
    });
    if (linked) {
      await db.equipment.update({
        where: { id: linked.id },
        data: { name, tempMin: item.min, tempMax: item.max },
      });
      return item;
    }
  }
  const areaId = await ensureDefaultArea(organizationId, pointId);
  const created = await db.equipment.create({
    data: {
      name,
      type: guessEquipmentType(item),
      tempMin: item.min,
      tempMax: item.max,
      areaId,
    },
    select: { id: true },
  });
  return { ...item, sourceEquipmentId: created.id };
}
