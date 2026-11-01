import type { Session } from "next-auth";
import { loadBuildingContext } from "@/lib/active-building";
import type { BuildingContext } from "@/lib/building-scope";

/**
 * Документ точки открывается только тем, кому эта точка доступна
 * (2026-11-01, «точка видит только своё»): сотрудник или руководитель
 * точки А не открывает, не правит и не удаляет документ точки Б даже по
 * прямой ссылке. Правило — как у переключателя в шапке
 * (`allowedBuildingsForUser`): офис, люди без точек, партнёр и ROOT при
 * импёрсонации видят все точки. Общий документ (без точки) и выключенные
 * точки — без ограничения.
 */
export function documentPointVisible(
  context: Pick<BuildingContext, "enabled" | "buildings">,
  documentBuildingId: string | null | undefined,
): boolean {
  if (!context.enabled || !documentBuildingId) return true;
  return context.buildings.some((building) => building.id === documentBuildingId);
}

/**
 * `where` документов, доступных человеку: общие и его точек. Пустой объект —
 * без ограничения (точки выключены). Занимает верхний `OR`.
 */
export function documentVisibleWhere(
  context: Pick<BuildingContext, "enabled" | "buildings">,
): { OR?: Array<{ buildingId: string | null | { in: string[] } }> } {
  if (!context.enabled) return {};
  return { OR: [{ buildingId: null }, { buildingId: { in: context.buildings.map((building) => building.id) } }] };
}

/**
 * Точки, для которых человек создаёт документы разом («Создать все»,
 * автосоздание): только доступные ему. `null` (точки выключены) остаётся.
 */
export function visibleBuildingTargets<T extends string | null>(
  targets: readonly T[],
  context: Pick<BuildingContext, "enabled" | "buildings">,
): T[] {
  return targets.filter((id) => id === null || documentPointVisible(context, id));
}

/** То же для сессии запроса; общий документ — без чтения контекста. */
export async function canSeeDocumentPoint(
  session: Session,
  documentBuildingId: string | null | undefined,
): Promise<boolean> {
  if (!documentBuildingId) return true;
  return documentPointVisible(await loadBuildingContext(session), documentBuildingId);
}

/**
 * Точка записи журнала без своего поля точки — как `journalEntryPointWhere`:
 * есть цех — его точка (общий цех — без точки), нет цеха — точка цеха
 * оборудования.
 */
export function journalEntryPointId(entry: {
  area?: { buildingId: string | null } | null;
  equipment?: { area?: { buildingId: string | null } | null } | null;
}): string | null {
  if (entry.area) return entry.area.buildingId ?? null;
  return entry.equipment?.area?.buildingId ?? null;
}

/** Поля записи журнала для `journalEntryPointId` (Prisma `select`/`include`). */
export const JOURNAL_ENTRY_POINT_SELECT = {
  area: { select: { buildingId: true } },
  equipment: { select: { area: { select: { buildingId: true } } } },
} as const;
