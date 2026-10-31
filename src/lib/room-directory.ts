/**
 * Единый справочник помещений (Room, /settings/buildings) — серверная
 * загрузка для страниц журналов и общая форма данных для клиентов.
 *
 * 2026-09-04: климат и график ген. уборок используют тот же справочник,
 * что и журнал уборки; карточка помещения (RoomEditorDialog) открывается
 * из любого журнала. Здесь — один select и одна форма, чтобы страницы
 * не расходились в наборе полей.
 */
import { db } from "@/lib/db";
import { orphanAreas } from "@/lib/orphan-areas";

export const ROOM_DIRECTORY_SELECT = {
  id: true,
  name: true,
  kind: true,
  detergent: true,
  currentScope: true,
  generalScope: true,
  currentDays: true,
  generalDays: true,
  currentScheduleType: true,
  generalScheduleType: true,
  currentMonthDays: true,
  generalMonthDays: true,
  requirePhoto: true,
  cleanerUserIds: true,
  verifierUserIds: true,
  climateNorms: true,
} as const;

/** Помещение справочника в форме, которую понимают клиенты журналов. */
export type DirectoryRoom = {
  id: string;
  name: string;
  kind: string;
  detergent: string;
  currentScope: unknown;
  generalScope: unknown;
  currentDays: number;
  generalDays: number;
  currentScheduleType: "weekly" | "monthly";
  generalScheduleType: "weekly" | "monthly";
  currentMonthDays: string[];
  generalMonthDays: string[];
  requirePhoto: boolean;
  cleanerUserIds: string[];
  verifierUserIds: string[];
  climateNorms: unknown;
};

export type DirectoryBuilding = {
  id: string;
  name: string;
  rooms: DirectoryRoom[];
};

function stringList(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((s): s is string => typeof s === "string")
    : [];
}

export async function loadDirectoryBuildings(
  organizationId: string,
): Promise<DirectoryBuilding[]> {
  const buildings = await db.building.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      rooms: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: ROOM_DIRECTORY_SELECT,
      },
    },
  });
  return buildings.map((b) => ({
    id: b.id,
    name: b.name,
    rooms: b.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      detergent: r.detergent ?? "",
      currentScope: r.currentScope,
      generalScope: r.generalScope,
      currentDays: r.currentDays,
      generalDays: r.generalDays,
      currentScheduleType: r.currentScheduleType === "monthly" ? "monthly" : "weekly",
      generalScheduleType: r.generalScheduleType === "monthly" ? "monthly" : "weekly",
      currentMonthDays: stringList(r.currentMonthDays),
      generalMonthDays: stringList(r.generalMonthDays),
      requirePhoto: r.requirePhoto === true,
      cleanerUserIds: r.cleanerUserIds,
      verifierUserIds: r.verifierUserIds,
      climateNorms: r.climateNorms,
    })),
  }));
}

/** Помещения, на которые ссылаются строки конфига (`config[key][].roomId`). */
export function configRoomIds(config: unknown, key: string): Set<string> {
  const list =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>)[key]
      : null;
  const ids = new Set<string>();
  if (!Array.isArray(list)) return ids;
  for (const row of list) {
    const roomId = row && typeof row === "object" ? (row as Record<string, unknown>).roomId : null;
    if (typeof roomId === "string" && roomId) ids.add(roomId);
  }
  return ids;
}

/**
 * Справочник помещений для документа точки (2026-10-31): точка документа —
 * первой (новое помещение из окна по умолчанию встаёт на неё), со всеми
 * помещениями; у других точек остаются только помещения, на которые уже
 * ссылаются строки документа, — чтобы их названия не пропали, но в выбор
 * чужие помещения не попадали. `pointId = null` — справочник как есть.
 */
export function scopeDirectoryBuildings(
  buildings: ReadonlyArray<DirectoryBuilding>,
  pointId: string | null,
  referencedRoomIds: ReadonlySet<string>,
): DirectoryBuilding[] {
  if (!pointId) return [...buildings];
  const own = buildings.filter((building) => building.id === pointId);
  const others = buildings
    .filter((building) => building.id !== pointId)
    .map((building) => ({ ...building, rooms: building.rooms.filter((room) => referencedRoomIds.has(room.id)) }))
    .filter((building) => building.rooms.length > 0);
  return [...own, ...others];
}

/** Цех (Area) без помещения с тем же названием — кандидат в помещение. */
export type OrphanArea = {
  id: string;
  name: string;
  equipmentCount: number;
};

/**
 * Цеха организации, для которых нет Room с тем же названием (без регистра,
 * ё=е). Показываются в окне «Добавить помещение» отдельной группой.
 */
export async function loadOrphanAreas(organizationId: string): Promise<OrphanArea[]> {
  const [areas, rooms] = await Promise.all([
    db.area.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { equipment: true } } },
    }),
    db.room.findMany({
      where: { building: { organizationId } },
      select: { name: true },
    }),
  ]);
  return orphanAreas(
    areas,
    rooms.map((r) => r.name),
  ).map((a) => ({ id: a.id, name: a.name, equipmentCount: a._count.equipment }));
}
