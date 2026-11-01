/**
 * Уведомления по точкам (2026-11-01, «точка видит только своё»): сводки
 * кронов собираются по точке события и уходят её людям и офису, а не
 * одной общей рассылкой на всю организацию.
 */

/**
 * Точка события для рассылки: точка организации при включённых точках
 * (`targets` из `buildingTargets`), иначе null — общее событие, как раньше.
 */
export function liveEventPoint(
  pointId: string | null | undefined,
  targets: ReadonlyArray<string | null>,
): string | null {
  return pointId && targets.includes(pointId) ? pointId : null;
}

/** Разложить элементы по точке события (null — общее), в порядке первого появления. */
export function groupByPoint<T>(items: readonly T[], pointOf: (item: T) => string | null): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>();
  for (const item of items) {
    const point = pointOf(item);
    const list = groups.get(point) ?? [];
    list.push(item);
    groups.set(point, list);
  }
  return groups;
}

/** Строка «Точка: …» в начале сообщения о точке; общее событие — пусто. */
export function pointHeading(pointName: string | null | undefined): string {
  return pointName ? `Точка: ${pointName}\n` : "";
}
