import { allowedBuildingsForUser, worksAtBuilding, type BuildingOption } from "@/lib/building-scope";
import { buildingTargets, userBuildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";

/**
 * Точки, которыми ограничен человек (телефон «Сетап помощника», бот Max) —
 * чтобы точка не видела чужое (партнёр, 2026-10-30: «чтобы ТТ не своё просто
 * не видела»). null — без ограничения: точки выключены или человек работает
 * на всех точках (пустой `buildingIds`).
 */
export type WorkerPointScope = {
  /** Точки человека (`userBuildingTargets`). */
  points: string[];
  /** Все точки организации — висящие id удалённых точек не отрезают людей. */
  orgBuildingIds: string[];
} | null;

export function workerPointScope(args: {
  allTargets: ReadonlyArray<string | null>;
  workTargets: ReadonlyArray<string | null>;
}): WorkerPointScope {
  const all = args.allTargets.filter((id): id is string => Boolean(id));
  const points = args.workTargets.filter((id): id is string => Boolean(id) && all.includes(id as string));
  if (all.length === 0 || points.length === 0 || points.length >= all.length) return null;
  return { points, orgBuildingIds: all };
}

/** Документ виден человеку: общий (без точки), чужой организации id или его точка. */
export function documentInWorkerScope(scope: WorkerPointScope, documentBuildingId: string | null | undefined): boolean {
  if (!scope || !documentBuildingId) return true;
  if (!scope.orgBuildingIds.includes(documentBuildingId)) return true;
  return scope.points.includes(documentBuildingId);
}

/** `where` документов области: свои точки и общие. Пустой объект — без фильтра. */
export function documentWorkerScopeWhere(scope: WorkerPointScope) {
  return scope ? { OR: [{ buildingId: null }, { buildingId: { in: scope.points } }] } : {};
}

/**
 * `where` людей области для Prisma — то же правило, что `personInWorkerScope`:
 * работает на одной из точек области, либо среди его точек нет ни одной
 * точки организации (пусто или только удалённые — работает везде).
 * Пустой объект — без фильтра.
 */
export function personWorkerScopeWhere(scope: WorkerPointScope) {
  return scope
    ? { OR: [{ buildingIds: { hasSome: scope.points } }, { NOT: { buildingIds: { hasSome: scope.orgBuildingIds } } }] }
    : {};
}

/**
 * Списания области (как `lossPointWhere`, но для нескольких точек): запись
 * своей точки, без точки — по цеху точки области или общему, без цеха — всем.
 * `areaIds` — цеха точек области и общие.
 */
export function lossWorkerScopeWhere(scope: WorkerPointScope, areaIds: readonly string[]) {
  if (!scope) return {};
  return {
    OR: [
      { buildingId: { in: scope.points } },
      { buildingId: null, areaId: null },
      { buildingId: null, areaId: { in: [...areaIds] } },
    ],
  };
}

/**
 * `JournalEntry` области (как `journalEntryPointWhere`, но для нескольких
 * точек): цех её точек или общий, без цеха — по оборудованию, без цеха и
 * оборудования — всем.
 */
export function journalEntryWorkerScopeWhere(scope: WorkerPointScope) {
  if (!scope) return {};
  const shared = [{ buildingId: { in: scope.points } }, { buildingId: null }];
  return {
    OR: [
      { areaId: null, equipmentId: null },
      { area: { OR: shared } },
      { areaId: null, equipment: { area: { OR: shared } } },
    ],
  };
}

/** Цеха точек области и общие — для `lossWorkerScopeWhere`. */
export async function loadScopeAreaIds(organizationId: string, scope: WorkerPointScope): Promise<string[]> {
  if (!scope) return [];
  const areas = await db.area.findMany({
    where: { organizationId, OR: [{ buildingId: { in: scope.points } }, { buildingId: null }] },
    select: { id: true },
  });
  return areas.map((area) => area.id);
}

/** Человек работает хотя бы на одной точке области (`worksAtBuilding`). */
export function personInWorkerScope(scope: WorkerPointScope, userBuildingIds: readonly string[] | null | undefined): boolean {
  if (!scope) return true;
  return scope.points.some((point) => worksAtBuilding(scope.orgBuildingIds, userBuildingIds ?? [], point));
}

export async function loadWorkerPointScope(organizationId: string, userId: string): Promise<WorkerPointScope> {
  const [allTargets, workTargets] = await Promise.all([
    buildingTargets(organizationId),
    userBuildingTargets(organizationId, userId),
  ]);
  return workerPointScope({ allTargets, workTargets });
}

/**
 * Точки, которые человек видит (аудит 2026-11-01): руководитель в боте,
 * ИИ-помощник, ключ API. Правило шапки сайта — `allowedBuildingsForUser`:
 * сотрудник офиса и человек без точек видят все точки (null), закреплённый
 * за точками — только свои. В отличие от `workerPointScope`, офис здесь не
 * сужает до офиса: сводка руководителя офиса — по всей компании.
 */
export function managerPointScope(args: {
  enabled: boolean;
  buildings: readonly BuildingOption[];
  userBuildingIds: readonly string[];
}): WorkerPointScope {
  if (!args.enabled || args.buildings.length < 2) return null;
  const all = args.buildings.map((building) => building.id);
  const allowed = allowedBuildingsForUser([...args.buildings], args.userBuildingIds).map((building) => building.id);
  return workerPointScope({ allTargets: all, workTargets: allowed });
}

/**
 * `managerPointScope` для человека из базы. Ограничение действует только в
 * домашней организации (как `loadBuildingContext`): партнёр и ROOT при
 * входе в чужую организацию видят все её точки.
 */
export async function loadManagerPointScope(organizationId: string, userId: string): Promise<WorkerPointScope> {
  const [organization, buildings, user] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { perLocationJournals: true } }),
    db.building.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, address: true, kind: true },
    }),
    db.user.findUnique({ where: { id: userId }, select: { organizationId: true, buildingIds: true } }),
  ]);
  const homeOrg = Boolean(user && user.organizationId === organizationId);
  return managerPointScope({
    enabled: organization?.perLocationJournals === true,
    buildings,
    userBuildingIds: homeOrg && user ? user.buildingIds : [],
  });
}

/**
 * Выключенные журналы для области: выключен только тот журнал, что выключен
 * на всех точках человека (у точки бывает свой набор). null — без области:
 * действует набор организации.
 */
export async function loadScopeDisabledCodes(organizationId: string, scope: WorkerPointScope): Promise<string[] | null> {
  if (!scope) return null;
  const sets = await Promise.all(scope.points.map((point) => getDisabledJournalCodes(organizationId, point)));
  return [...sets[0]].filter((code) => sets.every((set) => set.has(code)));
}

/**
 * Документ точки → проверка «работает на этой точке» для списка людей.
 * Точка документа берётся только из точек организации (`targets`); общий
 * документ или выключенные точки — все подходят.
 */
export function makeDocumentPointFilter(args: {
  targets: ReadonlyArray<string | null>;
  documentBuildingId: string | null | undefined;
  buildingIdsByUser: ReadonlyMap<string, readonly string[]>;
}): (userId: string) => boolean {
  const orgBuildingIds = args.targets.filter((id): id is string => Boolean(id));
  const point =
    args.documentBuildingId && orgBuildingIds.includes(args.documentBuildingId) ? args.documentBuildingId : null;
  if (!point) return () => true;
  return (userId) => worksAtBuilding(orgBuildingIds, args.buildingIdsByUser.get(userId) ?? [], point);
}
