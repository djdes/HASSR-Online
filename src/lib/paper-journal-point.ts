import { buildingWhere, isOfficeBuilding, viewedPointId, type BuildingContext } from "@/lib/building-scope";
import { documentVisibleWhere } from "@/lib/document-point-access";

/**
 * Бумажные журналы по точкам (владелец 2026-11-01: «бумажные привязывай к
 * точкам») — те же правила, что у документов электронных журналов:
 *  - новый документ принадлежит объекту из шапки; при «Выберите объект»
 *    (офис или вся организация) просим выбрать объект — офис не объект
 *    (владелец, 2026-11-23);
 *  - на объекте список — её документы и общие, на уровне
 *    организации — все доступные человеку;
 *  - документ чужой точки по прямой ссылке не открывается («не найдено»).
 * Документ без точки (старые, точки выключены) — общий.
 */
export const PAPER_POINT_REQUIRED = "Выберите объект в шапке: документ журнала создаётся для объекта.";

type PaperPointContext = Pick<BuildingContext, "enabled" | "organizationView" | "activeBuildingId" | "activeBuilding" | "buildings">;

/** Точка нового документа: `null` — общий (точки выключены); `error` — нужна точка. */
export function paperDocumentBuilding(context: PaperPointContext): { buildingId: string | null } | { error: string } {
  if (!context.enabled) return { buildingId: null };
  if (context.organizationView || isOfficeBuilding(context.activeBuilding)) return { error: PAPER_POINT_REQUIRED };
  return { buildingId: context.activeBuildingId };
}

/** `where` списка документов: на точке — её и общие, на уровне организации — все доступные. */
export function paperDocumentsListWhere(context: PaperPointContext): ReturnType<typeof documentVisibleWhere> | ReturnType<typeof buildingWhere> {
  const pointId = viewedPointId(context);
  return pointId ? buildingWhere(pointId) : documentVisibleWhere(context);
}

/** `where` одного документа: общие и точек, доступных человеку. */
export function paperDocumentVisibleWhere(context: PaperPointContext): ReturnType<typeof documentVisibleWhere> {
  return documentVisibleWhere(context);
}
