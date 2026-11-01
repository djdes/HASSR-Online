import { buildingWhere } from "@/lib/building-scope";
import { journalEntryPointWhere } from "@/lib/point-filters";
import { BUILDING_OUT_OF_SCOPE_ERROR } from "@/lib/point-scope";

/**
 * Ссылка проверяющего на одну точку (решение владельца 2026-11-01):
 * `InspectorToken.buildingId` — проверяющий видит документы этой точки и
 * общие (без точки), записи журналов — по цехам точки. null — вся
 * организация, как раньше. Чистые правила: выпуск, кто какие ссылки видит,
 * что показывает портал.
 */

export const INSPECTOR_ORG_LINK_FORBIDDEN =
  "Ссылку на всю организацию выдаёт руководство компании — выпустите ссылку для своей точки";
export const INSPECTOR_POINT_NOT_FOUND = "Точка не найдена";

export type InspectorIssuePoint =
  | { ok: true; buildingId: string | null }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Точка новой ссылки. `requested`: undefined — не прислали (по умолчанию),
 * null — явно «вся организация», строка — точка.
 *  - точки выключены — всегда вся организация;
 *  - по умолчанию: руководителю точки — точка из шапки, если она его, иначе
 *    первая его; остальным — точка из шапки (null в «Вся организация»);
 *  - руководителю точки — только свои точки, на всю организацию нельзя.
 */
export function resolveInspectorIssuePoint(args: {
  requested: string | null | undefined;
  pointsEnabled: boolean;
  orgBuildingIds: readonly string[];
  viewedPointId: string | null;
  pointScope: readonly string[] | null | undefined;
}): InspectorIssuePoint {
  const scope = args.pointScope && args.pointScope.length > 0 ? args.pointScope : null;
  if (!args.pointsEnabled) return { ok: true, buildingId: null };
  const viewed = args.viewedPointId && args.orgBuildingIds.includes(args.viewedPointId) ? args.viewedPointId : null;
  if (args.requested === undefined) {
    if (scope) return { ok: true, buildingId: viewed && scope.includes(viewed) ? viewed : scope[0] };
    return { ok: true, buildingId: viewed };
  }
  if (args.requested === null) {
    return scope ? { ok: false, status: 403, error: INSPECTOR_ORG_LINK_FORBIDDEN } : { ok: true, buildingId: null };
  }
  if (!args.orgBuildingIds.includes(args.requested)) return { ok: false, status: 400, error: INSPECTOR_POINT_NOT_FOUND };
  if (scope && !scope.includes(args.requested)) return { ok: false, status: 403, error: BUILDING_OUT_OF_SCOPE_ERROR };
  return { ok: true, buildingId: args.requested };
}

/** Ссылки, которые человек видит и отзывает: руководитель точки — только своих точек. */
export function inspectorTokensWhere(pointScope: readonly string[] | null | undefined): { buildingId?: { in: string[] } } {
  return pointScope && pointScope.length > 0 ? { buildingId: { in: [...pointScope] } } : {};
}

export function inspectorTokenVisible(
  pointScope: readonly string[] | null | undefined,
  tokenBuildingId: string | null | undefined,
): boolean {
  if (!pointScope || pointScope.length === 0) return true;
  return Boolean(tokenBuildingId) && pointScope.includes(tokenBuildingId as string);
}

/** Документы портала: точки ссылки и общие; у ссылки на организацию — все. */
export function inspectorDocumentWhere(tokenBuildingId: string | null | undefined) {
  return buildingWhere(tokenBuildingId);
}

/** Записи журналов без документа: по цеху / оборудованию точки ссылки. */
export function inspectorEntryWhere(tokenBuildingId: string | null | undefined) {
  return journalEntryPointWhere(tokenBuildingId);
}

/** Документ доступен по ссылке: ссылка на организацию, общий документ или своя точка. */
export function inspectorDocumentVisible(
  tokenBuildingId: string | null | undefined,
  documentBuildingId: string | null | undefined,
): boolean {
  return !tokenBuildingId || !documentBuildingId || documentBuildingId === tokenBuildingId;
}

/** Подпись ссылки в кабинете и на портале. */
export function inspectorScopeLabel(buildingName: string | null | undefined): string {
  return buildingName ? `Точка «${buildingName}»` : "Вся организация";
}
