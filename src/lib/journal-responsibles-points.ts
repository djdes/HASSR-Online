import { worksAtBuilding } from "@/lib/building-scope";
import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";

/**
 * Ответственные за журналы по точкам (владелец, 2026-10-31: «ответственные по
 * точкам»).
 *
 * У организации — общая карта `Organization.journalResponsibleUsersJson`
 * ({ [journalCode]: { [slotId]: userId } }), у точки — своя
 * `Building.journalResponsibleUsersJson` того же вида. Для документа точки
 * действуют:
 *  - ответственные точки, если для журнала они заданы («своё для точки»);
 *  - иначе ответственные организации — но только те, кто работает на этой
 *    точке; слот с человеком другой точки пустой, его потом заполняет
 *    авто-подбор из сотрудников точки.
 * Документ без точки и организация без точек — карта организации как есть.
 */

export type SlotUserMap = Record<string, string | null>;
export type SlotMaps = Record<string, SlotUserMap>;

/** Карта ответственных из JSON: только объекты слотов со строками или null. */
export function parseSlotMaps(json: unknown): SlotMaps {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const out: SlotMaps = {};
  for (const [code, value] of Object.entries(json as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const slots: SlotUserMap = {};
    for (const [slotId, userId] of Object.entries(value as Record<string, unknown>)) {
      slots[slotId] = typeof userId === "string" && userId.length > 0 ? userId : null;
    }
    out[code] = slots;
  }
  return out;
}

/**
 * Действующие ответственные точки (чистое ядро): своё точки по журналу или
 * организации; люди, которые на точке не работают, — пустые слоты.
 */
export function resolvePointSlots(args: {
  orgSlots: SlotMaps;
  pointSlots: SlotMaps | null;
  worksAtPoint: (userId: string) => boolean;
}): { slots: SlotMaps; ownCodes: Set<string> } {
  const codes = new Set([...Object.keys(args.orgSlots), ...Object.keys(args.pointSlots ?? {})]);
  const slots: SlotMaps = {};
  const ownCodes = new Set<string>();
  for (const code of codes) {
    const own = Boolean(args.pointSlots && Object.hasOwn(args.pointSlots, code));
    if (own) ownCodes.add(code);
    const source = (own ? args.pointSlots?.[code] : args.orgSlots[code]) ?? {};
    const filtered: SlotUserMap = {};
    for (const [slotId, userId] of Object.entries(source)) {
      filtered[slotId] = userId && args.worksAtPoint(userId) ? userId : null;
    }
    slots[code] = filtered;
  }
  return { slots, ownCodes };
}

/** Слоты, которые были заданы, но для точки опустели (человек другой точки). */
export function droppedSlotIds(source: SlotUserMap | undefined, effective: SlotUserMap | undefined): string[] {
  return Object.entries(source ?? {})
    .filter(([slotId, userId]) => Boolean(userId) && !effective?.[slotId])
    .map(([slotId]) => slotId);
}

export type EffectiveResponsibles = {
  /** Точка, для которой посчитано; null — организация (без точек или документ без точки). */
  pointId: string | null;
  /** Ответственные организации как есть. */
  orgSlots: SlotMaps;
  /** Действующие ответственные (у точки — см. `resolvePointSlots`). */
  slots: SlotMaps;
  /** Журналы, у которых на точке свои ответственные. */
  ownCodes: Set<string>;
};

function collectUserIds(...maps: SlotMaps[]): string[] {
  const ids = new Set<string>();
  for (const map of maps) {
    for (const slots of Object.values(map)) {
      for (const userId of Object.values(slots)) if (userId) ids.add(userId);
    }
  }
  return [...ids];
}

/**
 * Ответственные за журналы для документа или экрана точки. `buildingId` не
 * точка этой организации (точки выключены, офис без журналов по точкам,
 * чужой id) — организация.
 */
export async function loadEffectiveResponsibleSlots(
  organizationId: string,
  buildingId: string | null | undefined,
): Promise<EffectiveResponsibles> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { journalResponsibleUsersJson: true },
  });
  const orgSlots = parseSlotMaps(org?.journalResponsibleUsersJson);
  const asOrg: EffectiveResponsibles = { pointId: null, orgSlots, slots: orgSlots, ownCodes: new Set() };
  if (!buildingId) return asOrg;
  const targets = await buildingTargets(organizationId);
  if (!targets.includes(buildingId)) return asOrg;
  const orgBuildingIds = targets.filter((id): id is string => id !== null);
  const building = await db.building.findFirst({
    where: { id: buildingId, organizationId },
    select: { journalResponsibleUsersJson: true },
  });
  const pointSlots = building?.journalResponsibleUsersJson == null ? null : parseSlotMaps(building.journalResponsibleUsersJson);
  const userIds = collectUserIds(orgSlots, pointSlots ?? {});
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds }, organizationId }, select: { id: true, buildingIds: true } })
    : [];
  const pointsByUser = new Map(users.map((user) => [user.id, user.buildingIds ?? []]));
  const { slots, ownCodes } = resolvePointSlots({
    orgSlots,
    pointSlots,
    // Неизвестный (уволен, удалён) — не наша забота здесь: его отбрасывает
    // проверка «жив и из этой организации» у того, кто читает слоты.
    worksAtPoint: (userId) => {
      const ids = pointsByUser.get(userId);
      return !ids || worksAtBuilding(orgBuildingIds, ids, buildingId);
    },
  });
  return { pointId: buildingId, orgSlots, slots, ownCodes };
}

/** Действующие ответственные одного журнала для точки (или организации). */
export async function effectiveJournalSlots(
  organizationId: string,
  buildingId: string | null | undefined,
  journalCode: string,
): Promise<SlotUserMap> {
  const effective = await loadEffectiveResponsibleSlots(organizationId, buildingId);
  return { ...(effective.slots[journalCode] ?? {}) };
}

/**
 * Записать ответственных точки по журналу; `slots = null` — убрать своё,
 * журнал снова «как у организации».
 */
export async function savePointJournalSlots(
  organizationId: string,
  buildingId: string,
  journalCode: string,
  slots: SlotUserMap | null,
): Promise<void> {
  const building = await db.building.findFirst({
    where: { id: buildingId, organizationId },
    select: { journalResponsibleUsersJson: true },
  });
  if (!building) throw new Error("Точка не найдена");
  const all = parseSlotMaps(building.journalResponsibleUsersJson);
  if (slots) all[journalCode] = { ...slots };
  else delete all[journalCode];
  await db.building.update({
    where: { id: buildingId },
    data: { journalResponsibleUsersJson: (Object.keys(all).length > 0 ? all : null) as never },
  });
}

/** Убрать человека из ответственных всех точек организации (архив, удаление). */
export function withoutUser(maps: SlotMaps, userId: string): { maps: SlotMaps; changed: boolean } {
  let changed = false;
  const next: SlotMaps = {};
  for (const [code, slots] of Object.entries(maps)) {
    const copy: SlotUserMap = { ...slots };
    for (const [slotId, value] of Object.entries(copy)) {
      if (value === userId) {
        copy[slotId] = null;
        changed = true;
      }
    }
    next[code] = copy;
  }
  return { maps: next, changed };
}

export async function removeUserFromPointResponsibles(organizationId: string, userId: string): Promise<number> {
  const buildings = await db.building.findMany({
    where: { organizationId },
    select: { id: true, journalResponsibleUsersJson: true },
  });
  let updated = 0;
  for (const building of buildings) {
    if (building.journalResponsibleUsersJson == null) continue;
    const { maps, changed } = withoutUser(parseSlotMaps(building.journalResponsibleUsersJson), userId);
    if (!changed) continue;
    await db.building.update({ where: { id: building.id }, data: { journalResponsibleUsersJson: maps as never } });
    updated += 1;
  }
  return updated;
}
