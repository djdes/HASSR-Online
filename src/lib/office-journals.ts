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

/** Клиент базы для `documentBuildingFor`: нужен только список зданий организации. */
export type OrganizationBuildingsClient = {
  building: {
    findMany(args: {
      where: { organizationId: string };
      select: { id: true; kind: true; sortOrder: true; name: true };
    }): Promise<OrderedBuilding[]>;
  };
};

/**
 * Здание нового документа журнала (финальная проверка 2026-11-24): офис — не
 * объект, документ на офис не заводится. Если путь создания принёс офис
 * (оборудование, помещение или сотрудник офиса, точка приёмки, запрос внешнего
 * API), документ получает единственный или первый по списку объект — то же
 * правило, что для перенесённых журналов офиса. Объектов нет — общий документ
 * (null). Не офис — как есть.
 */
export async function documentBuildingFor(
  client: OrganizationBuildingsClient,
  organizationId: string,
  buildingId: string | null,
): Promise<string | null> {
  if (!buildingId) return null;
  const buildings = await client.building.findMany({
    where: { organizationId },
    select: { id: true, kind: true, sortOrder: true, name: true },
  });
  const building = buildings.find((item) => item.id === buildingId);
  if (!building || !isOfficeBuilding(building)) return buildingId;
  return officeJournalTarget(buildings);
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

/** Документ журнала для плана переноса: вид журнала и период (null — без даты, открытый край). */
export type MovableDocument = { id: string; key: string; dateFrom: Date | null; dateTo: Date | null };

/** Периоды пересекаются; null — открытый край (бумажный бланк без дат — на всё время). */
function periodsOverlap(
  a: { dateFrom: Date | null; dateTo: Date | null },
  b: { dateFrom: Date | null; dateTo: Date | null },
): boolean {
  const aFrom = a.dateFrom?.getTime() ?? -Infinity;
  const aTo = a.dateTo?.getTime() ?? Infinity;
  const bFrom = b.dateFrom?.getTime() ?? -Infinity;
  const bTo = b.dateTo?.getTime() ?? Infinity;
  return aFrom <= bTo && bFrom <= aTo;
}

/**
 * Какие документы офиса переносить на объект (ревью 2026-11-24): автоматика
 * до этой поставки заводила копию журнала и на офис, и на объекты — перенос
 * такой копии дал бы на объекте два документа одного журнала за один период.
 * Поэтому:
 *   • `overlap` — у объекта уже есть документ того же журнала за
 *     пересекающийся период (любой статус) — не трогаем;
 *   • `disabled` — журнал выключен на объекте: там документ не было бы видно;
 *   • `move` — остальное: журнал, заведённый в офисе руками, без пары на объекте.
 * `key` — код шаблона (электронные) или id бумажного журнала.
 */
export function planOfficeJournalMoves(
  officeDocuments: readonly MovableDocument[],
  targetDocuments: ReadonlyArray<Omit<MovableDocument, "id">>,
  disabledKeys: ReadonlySet<string>,
): { move: string[]; overlap: string[]; disabled: string[] } {
  const plan = { move: [] as string[], overlap: [] as string[], disabled: [] as string[] };
  for (const document of officeDocuments) {
    if (disabledKeys.has(document.key)) plan.disabled.push(document.id);
    else if (targetDocuments.some((other) => other.key === document.key && periodsOverlap(document, other))) plan.overlap.push(document.id);
    else plan.move.push(document.id);
  }
  return plan;
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
