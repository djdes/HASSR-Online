import { buildingWhere, viewedPointId, type BuildingContext } from "@/lib/building-scope";
import { documentPointVisible, documentVisibleWhere } from "@/lib/document-point-access";
import { BUILDING_OUT_OF_SCOPE_ERROR } from "@/lib/point-scope";

/**
 * Партии и CAPA по точкам (решение владельца 2026-11-01): у записи есть
 * `buildingId`, null — общая на всю организацию. Точка видит свои записи и
 * общие; руководство в «Вся организация» — все, с подписью точки.
 */
type RecordContext = Pick<
  BuildingContext,
  "enabled" | "buildings" | "organizationView" | "activeBuildingId" | "canViewOrganization"
>;

type RecordsWhere = { AND?: Array<Record<string, unknown>> };

/**
 * `where` списков и счётчиков: точка из шапки (её записи и общие) и только
 * доступные человеку точки (`allowedBuildingsForUser`). Занимает верхний
 * `AND` — не смешивать с другим верхним `AND`. Пустой — точки выключены.
 */
export function pointRecordsWhere(context: RecordContext): RecordsWhere {
  if (!context.enabled) return {};
  return { AND: [buildingWhere(viewedPointId(context)), documentVisibleWhere(context)] };
}

/** То же для конкретной точки (отчёт по точке, точка документа); null — без ограничения точкой. */
export function recordsAtPointWhere(pointId: string | null | undefined): RecordsWhere {
  return pointId ? { AND: [buildingWhere(pointId)] } : {};
}

/**
 * Запись видна человеку: общая или точки, доступной ему (как документ
 * журнала). Чужая точка — «не найдено».
 */
export function pointRecordVisible(
  context: Pick<BuildingContext, "enabled" | "buildings">,
  buildingId: string | null | undefined,
): boolean {
  return documentPointVisible(context, buildingId);
}

export type NewRecordPoint =
  | { ok: true; buildingId: string | null }
  | { ok: false; status: 403; error: string };

/**
 * Точка новой записи:
 *  - явная точка из запроса — только доступная человеку;
 *  - явное «вся организация» (null) — только тому, кто видит всю организацию;
 *  - без указания — точка из шапки (в «Вся организация» — общая запись).
 */
export function newRecordPoint(context: RecordContext, requested: unknown): NewRecordPoint {
  if (!context.enabled) return { ok: true, buildingId: null };
  if (typeof requested === "string" && requested.length > 0) {
    return context.buildings.some((building) => building.id === requested)
      ? { ok: true, buildingId: requested }
      : { ok: false, status: 403, error: BUILDING_OUT_OF_SCOPE_ERROR };
  }
  if (requested === null && context.canViewOrganization) return { ok: true, buildingId: null };
  return { ok: true, buildingId: viewedPointId(context) };
}
