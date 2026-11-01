/**
 * Зеркало «помещение (`Room`) ↔ цех (`Area`)» с точкой цеха — серверная
 * часть (БД). Правила выбора — чистые функции в `area-building.ts`.
 *
 * С 2026-10-17 цех знает точку: зеркало помещения точки 1 — цех точки 1
 * (или цех без точки, который тогда получает точку). Одноимённые
 * помещения разных точек больше не делят один цех.
 */
import { db } from "@/lib/db";
import { pickMirrorArea } from "@/lib/area-building";

async function orgAreas(organizationId: string) {
  return db.area.findMany({
    where: { organizationId },
    select: { id: true, name: true, buildingId: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Цех-зеркало помещения: найденный (с заполнением точки) или новый.
 * Возвращает id цеха.
 */
export async function ensureRoomMirrorArea(params: {
  organizationId: string;
  room: { id?: string; name: string; buildingId: string };
}): Promise<string> {
  const { organizationId, room } = params;
  const mirror = pickMirrorArea(await orgAreas(organizationId), room.name, room.buildingId);
  if (mirror) {
    if (!mirror.buildingId) {
      await db.area.update({ where: { id: mirror.id }, data: { buildingId: room.buildingId } });
    }
    return mirror.id;
  }
  const created = await db.area.create({
    data: {
      organizationId,
      name: room.name.trim(),
      buildingId: room.buildingId,
      description: room.id
        ? `Авто-создан из Помещения «${room.name.trim()}» (Building/Room ${room.id})`
        : `Авто-создан из Помещения «${room.name.trim()}»`,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Переименование помещения: переименовываем только его цех (этой точки
 * или без точки — тогда он получает точку). Раньше `updateMany` по имени
 * переименовывал и одноимённый цех другой точки.
 */
export async function renameRoomMirrorArea(params: {
  organizationId: string;
  buildingId: string;
  previousName: string;
  nextName: string;
}): Promise<void> {
  const mirror = pickMirrorArea(
    await orgAreas(params.organizationId),
    params.previousName,
    params.buildingId,
  );
  if (!mirror) return;
  await db.area.update({
    where: { id: mirror.id },
    data: { name: params.nextName.trim(), buildingId: params.buildingId },
  });
}

/** Удаление помещения: цех-зеркало удаляется, только если к нему ничего не привязано. */
export async function deleteRoomMirrorArea(params: {
  organizationId: string;
  buildingId: string;
  name: string;
}): Promise<void> {
  const mirror = pickMirrorArea(await orgAreas(params.organizationId), params.name, params.buildingId);
  if (!mirror) return;
  const usage = await db.area.findUnique({
    where: { id: mirror.id },
    select: { _count: { select: { equipment: true, journalEntries: true } } },
  });
  if (usage && usage._count.equipment === 0 && usage._count.journalEntries === 0) {
    await db.area.delete({ where: { id: mirror.id } });
  }
}

/** Точка по умолчанию для нового цеха: единственная точка организации, иначе нет. */
export async function soleBuildingId(organizationId: string): Promise<string | null> {
  const buildings = await db.building.findMany({
    where: { organizationId },
    select: { id: true },
    take: 2,
  });
  return buildings.length === 1 ? buildings[0].id : null;
}

/**
 * Точка из тела запроса: `undefined` — не передана, `null` — «без точки»,
 * строка — только точка этой организации (иначе `{ ok: false }`).
 */
export async function resolveBuildingInput(
  organizationId: string,
  raw: unknown,
): Promise<{ ok: true; buildingId: string | null | undefined } | { ok: false }> {
  if (raw === undefined) return { ok: true, buildingId: undefined };
  if (raw === null || raw === "") return { ok: true, buildingId: null };
  if (typeof raw !== "string") return { ok: false };
  const building = await db.building.findFirst({
    where: { id: raw, organizationId },
    select: { id: true },
  });
  return building ? { ok: true, buildingId: building.id } : { ok: false };
}

/**
 * Помещение оборудования из окна: цех (`areaId`) или помещение точки без
 * цеха (`roomId` — цех создаётся с этой точкой). Только своей организации.
 * Ничего не передано — `areaId: null` (вызывающий решает, ошибка ли это).
 *
 * `pointError` (аудит точек, 2026-11-01) — проверка точки места до любых
 * изменений: руководитель точки не ставит оборудование в цех чужой точки,
 * и цех-зеркало чужого помещения не создаётся. Текст отказа → 403.
 */
export async function resolveEquipmentArea(
  organizationId: string,
  input: { areaId?: unknown; roomId?: unknown },
  pointError?: (buildingId: string | null) => string | null,
): Promise<
  | { ok: true; areaId: string | null; buildingId: string | null }
  | { ok: false; error: string; status?: number }
> {
  if (typeof input.areaId === "string" && input.areaId) {
    const area = await db.area.findFirst({
      where: { id: input.areaId, organizationId },
      select: { id: true, buildingId: true },
    });
    if (!area) return { ok: false, error: "Цех не найден" };
    const denied = pointError?.(area.buildingId) ?? null;
    if (denied) return { ok: false, error: denied, status: 403 };
    return { ok: true, areaId: area.id, buildingId: area.buildingId };
  }
  if (typeof input.roomId === "string" && input.roomId) {
    const room = await db.room.findFirst({
      where: { id: input.roomId, building: { organizationId } },
      select: { id: true, name: true, buildingId: true },
    });
    if (!room) return { ok: false, error: "Помещение не найдено" };
    const denied = pointError?.(room.buildingId) ?? null;
    if (denied) return { ok: false, error: denied, status: 403 };
    return { ok: true, areaId: await ensureRoomMirrorArea({ organizationId, room }), buildingId: room.buildingId };
  }
  return { ok: true, areaId: null, buildingId: null };
}
