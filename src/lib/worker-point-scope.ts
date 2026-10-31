import { worksAtBuilding } from "@/lib/building-scope";
import { buildingTargets, userBuildingTargets } from "@/lib/building-targets";

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
