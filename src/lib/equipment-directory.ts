import { db } from "@/lib/db";
import { equipmentBuildingWhere } from "@/lib/building-scope";
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

export type EquipmentDirectorySyncResult =
  | { ok: true; item: ColdEquipmentConfigItem }
  | { ok: false; error: string; status: number };

/**
 * Обновляет запись справочника или создаёт её. Возвращает строку с
 * заполненным `sourceEquipmentId`. `pointId` — точка документа: новая запись
 * встаёт в её цех.
 *
 * Связанную запись ищем только среди оборудования точки документа и общего
 * (2026-11-01, «точка видит только своё»): через журнал точки А правили
 * холодильник точки Б. Запись другой точки не меняем и копию не заводим — 404;
 * удалённую из справочника, как раньше, заводим заново. `pointError` —
 * проверка точки записи перед правкой (руководитель точки не меняет чужой и
 * общий холодильник), текст отказа → 403.
 */
export async function syncEquipmentDirectoryItem(
  organizationId: string,
  item: ColdEquipmentConfigItem,
  pointId: string | null = null,
  pointError?: (buildingId: string | null) => string | null,
): Promise<EquipmentDirectorySyncResult> {
  const name = item.name.trim().slice(0, 200);
  if (item.sourceEquipmentId) {
    const linked = await db.equipment.findFirst({
      where: { id: item.sourceEquipmentId, area: { organizationId }, ...equipmentBuildingWhere(pointId) },
      select: { id: true, name: true, tempMin: true, tempMax: true, area: { select: { buildingId: true } } },
    });
    if (linked) {
      // Без изменений запись не трогаем: строку общего холодильника
      // руководитель точки сохраняет (режим замеров) и печатает QR.
      if (linked.name === name && linked.tempMin === item.min && linked.tempMax === item.max) {
        return { ok: true, item };
      }
      const denied = pointError?.(linked.area.buildingId) ?? null;
      if (denied) return { ok: false, error: denied, status: 403 };
      await db.equipment.update({
        where: { id: linked.id },
        data: { name, tempMin: item.min, tempMax: item.max },
      });
      return { ok: true, item };
    }
    if (pointId) {
      const foreign = await db.equipment.findFirst({
        where: { id: item.sourceEquipmentId, area: { organizationId } },
        select: { id: true },
      });
      if (foreign) {
        return { ok: false, error: `Холодильник «${name}» не найден на точке документа`, status: 404 };
      }
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
  return { ok: true, item: { ...item, sourceEquipmentId: created.id } };
}
