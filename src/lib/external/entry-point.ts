/**
 * Точка строк внешнего API (`POST /api/external/entries`, 2026-11-01).
 * Раньше строки писались в самый свежий активный документ любой точки, а
 * без документа создавался общий (без точки) — сотрудники точки Б
 * оказывались в журнале точки А. Теперь точка документа:
 *  - явная `buildingId` в запросе (точка этой организации, все сотрудники
 *    строк на ней работают);
 *  - иначе единственная общая точка всех сотрудников строк;
 *  - несколько возможных точек (сотрудник работает на всех) — не угадываем:
 *    подойдёт только живой общий документ, иначе просим `buildingId`;
 *  - точки выключены — как раньше, без точки.
 * Чистая функция: точки сотрудников считает вызывающий
 * (`userBuildingTargets`), здесь только правило.
 */

export type ExternalEntryPoint =
  | { ok: true; pointId: string | null; ambiguous?: false }
  | { ok: true; pointId: null; ambiguous: true; candidates: string[] }
  | { ok: false; error: string };

export function resolveExternalEntryPoint(args: {
  /** `buildingTargets(org)`: id точек или `[null]` без точек. */
  targets: ReadonlyArray<string | null>;
  /** `buildingId` из запроса. */
  requested?: string | null;
  /** Сотрудники строк и точки, где каждый работает (`userBuildingTargets`). */
  employees: ReadonlyArray<{ id: string; points: ReadonlyArray<string | null> }>;
}): ExternalEntryPoint {
  const orgPoints = args.targets.filter((id): id is string => Boolean(id));
  if (orgPoints.length === 0) return { ok: true, pointId: null };
  const pointsOf = (employee: { points: ReadonlyArray<string | null> }) => {
    const own = employee.points.filter((id): id is string => Boolean(id) && orgPoints.includes(id as string));
    return own.length > 0 ? own : orgPoints;
  };

  const requested = args.requested?.trim() || null;
  if (requested) {
    if (!orgPoints.includes(requested)) {
      return { ok: false, error: `buildingId ${requested} не найден среди точек организации` };
    }
    const outside = args.employees.filter((employee) => !pointsOf(employee).includes(requested));
    if (outside.length > 0) {
      return {
        ok: false,
        error: `сотрудник ${outside.map((employee) => employee.id).join(", ")} не работает на точке ${requested}`,
      };
    }
    return { ok: true, pointId: requested };
  }

  let common = [...orgPoints];
  for (const employee of args.employees) {
    const points = pointsOf(employee);
    common = common.filter((id) => points.includes(id));
  }
  if (common.length === 1) return { ok: true, pointId: common[0] };
  if (common.length === 0) {
    return {
      ok: false,
      error: "строки относятся к сотрудникам разных точек — отправьте строки каждой точки отдельным запросом или укажите buildingId",
    };
  }
  return { ok: true, pointId: null, ambiguous: true, candidates: common };
}
