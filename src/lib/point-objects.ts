/**
 * Объекты точки — цеха, помещения, оборудование, планшеты (аудит точек,
 * 2026-11-01): кто их правит и что предлагать в окнах справочников.
 *
 * Руководитель точки (`pointScope`, фаза 2 «Офис и точки») правит только
 * объекты своих точек. Объект без точки — общий на всю компанию, его ведёт
 * офис: то же правило, что у правки самой точки (`api/settings/buildings/[id]`
 * через `buildingInScope`). Модуль без Prisma — его читают API, страницы и тесты.
 */
import { worksAtBuilding } from "@/lib/building-scope";
import { BUILDING_OUT_OF_SCOPE_ERROR, buildingInScope, isPointScoped, type PointScopeActor } from "@/lib/point-scope";

export const SHARED_OBJECT_OFFICE_ERROR = "Объекты без точки ведёт офис — выберите свою точку";

/** Может ли человек править объект точки `buildingId` (null — объект без точки). */
export function canEditObjectAt(actor: PointScopeActor | null | undefined, buildingId: string | null | undefined): boolean {
  return buildingInScope(actor, buildingId ?? null);
}

/** Текст отказа для объекта точки `buildingId`; null — править можно. */
export function objectPointError(
  actor: PointScopeActor | null | undefined,
  buildingId: string | null | undefined,
): string | null {
  if (canEditObjectAt(actor, buildingId)) return null;
  return buildingId ? BUILDING_OUT_OF_SCOPE_ERROR : SHARED_OBJECT_OFFICE_ERROR;
}

/**
 * Точки, объекты которых человек видит и выбирает на страницах справочников:
 * его точки (`BuildingContext.buildings`, как переключатель в шапке) в пределах
 * руководителя точки. null — без ограничения (точки выключены).
 */
export function objectScopeIds(args: {
  enabled: boolean;
  personBuildingIds: readonly string[];
  actor: PointScopeActor | null | undefined;
}): Set<string> | null {
  if (!args.enabled) return null;
  return new Set(args.personBuildingIds.filter((id) => buildingInScope(args.actor, id)));
}

/** Объект точки `buildingId` в области: общий объект и объект неизвестной точки видны всем. */
export function objectInScope(
  scopeIds: ReadonlySet<string> | null,
  orgBuildingIds: readonly string[],
  buildingId: string | null | undefined,
): boolean {
  if (!scopeIds || !buildingId || !orgBuildingIds.includes(buildingId)) return true;
  return scopeIds.has(buildingId);
}

/**
 * Можно ли выбрать объект в окне (куда поставить оборудование, какой цех):
 * как `objectInScope`, но руководителю точки общие объекты не предлагаем —
 * сохранить в них он всё равно не сможет.
 */
export function objectSelectable(
  actor: PointScopeActor | null | undefined,
  scopeIds: ReadonlySet<string> | null,
  orgBuildingIds: readonly string[],
  buildingId: string | null | undefined,
): boolean {
  if (!buildingId || !orgBuildingIds.includes(buildingId)) return !isPointScoped(actor);
  return objectInScope(scopeIds, orgBuildingIds, buildingId);
}

/**
 * Сотрудник работает хотя бы на одной точке области — для выбора людей в окнах
 * объектов («Кто заполняет», «Кто убирает»). Правила `worksAtBuilding`: пустые
 * точки — везде, только удалённые точки — тоже везде.
 */
export function staffInObjectScope(
  scopeIds: ReadonlySet<string> | null,
  orgBuildingIds: readonly string[],
  userBuildingIds: readonly string[],
): boolean {
  if (!scopeIds) return true;
  for (const id of scopeIds) {
    if (worksAtBuilding(orgBuildingIds, userBuildingIds, id)) return true;
  }
  return false;
}
