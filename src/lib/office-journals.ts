import { isOfficeBuilding, type BuildingOption } from "@/lib/building-scope";

/**
 * Офис — не объект (владелец, 2026-11-23): «Мы не считаем офис за объект…
 * при создании журналов мы должны привязать его обязательно к объекту», «если
 * журнал в офисе уже создан и там не указан объект, привязывать к единственному
 * созданному или первому по списку объекту». Чистые правила без Prisma — их
 * читают API создания документа, раздача документов по объектам, разовый
 * перенос на деплое (`prisma/seed-office-journals-to-points-2026-11.ts`) и тесты.
 */

/** Здание организации для выбора объекта: вид, место в списке, название. */
export type OrderedBuilding = { id: string; kind?: string | null; sortOrder: number; name: string };

/**
 * Куда перенести документ офиса: единственный объект организации, а если
 * объектов несколько — первый по списку (порядок объектов, затем название,
 * как в шапке и на странице «Объекты»). Объектов нет — null: переносить некуда.
 */
export function officeJournalTarget(buildings: readonly OrderedBuilding[]): string | null {
  const points = buildings
    .filter((building) => !isOfficeBuilding(building))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru"));
  return points[0]?.id ?? null;
}

/**
 * На какие здания раздавать документы журналов: только объекты. Журналы по
 * объектам выключены или зданий меньше двух — `[null]`, один общий документ,
 * как раньше (`buildingTargets`).
 */
export function documentTargetIds(
  perLocationJournals: boolean,
  buildings: ReadonlyArray<{ id: string; kind?: string | null }>,
): Array<string | null> {
  if (!perLocationJournals || buildings.length < 2) return [null];
  const points = buildings.filter((building) => !isOfficeBuilding(building)).map((building) => building.id);
  return points.length > 0 ? points : [null];
}

/** Код ответа API, когда документ создают без объекта (`point_required`). */
export const POINT_REQUIRED_CODE = "point_required";

/**
 * Почему документ журнала нельзя создать здесь: объект не найден среди
 * доступных (`not_found`) или объект не выбран — в шапке «Выберите объект»
 * (офис или вся организация), а явного объекта нет или это офис
 * (`point_required`). null — создавать можно. Объекты выключены — без требований.
 */
export function documentPointProblem(
  context: {
    enabled: boolean;
    buildings: readonly BuildingOption[];
    organizationView: boolean;
    activeBuilding: BuildingOption | null;
  },
  requestedBuildingId: string | null,
): "not_found" | typeof POINT_REQUIRED_CODE | null {
  if (!context.enabled) return null;
  if (requestedBuildingId) {
    const requested = context.buildings.find((building) => building.id === requestedBuildingId);
    if (!requested) return "not_found";
    return isOfficeBuilding(requested) ? POINT_REQUIRED_CODE : null;
  }
  return context.organizationView || isOfficeBuilding(context.activeBuilding) ? POINT_REQUIRED_CODE : null;
}
