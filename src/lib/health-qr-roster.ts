/**
 * QR «Гигиена и здоровье» по точке (владелец, 2026-10-29: на вкладке
 * «Допуск сотрудников» точки была вся организация — ~60 человек вместо
 * сотрудников гимназии).
 */

/**
 * Парный документ (гигиена ↔ здоровье) на сегодня: той же точки, иначе
 * общий (без точки). Документ другой точки не берём никогда — иначе
 * отметка сотрудника ложилась в журнал чужой точки. У общего документа —
 * общий парный, иначе первый найденный, как раньше.
 */
export function pickCompanionDocument<T extends { buildingId: string | null }>(
  candidates: readonly T[],
  primaryBuildingId: string | null,
): T | null {
  if (!primaryBuildingId) return candidates.find((doc) => doc.buildingId === null) ?? candidates[0] ?? null;
  return (
    candidates.find((doc) => doc.buildingId === primaryBuildingId) ??
    candidates.find((doc) => doc.buildingId === null) ??
    null
  );
}

/**
 * Список «Допуск сотрудников»: сотрудники точки документа (из них — с
 * пометкой «Замена»), плюс тот, кто уже по-настоящему отметился сегодня в
 * этом документе, хоть и числится на другой точке, — его допуск всё равно
 * нужно подписать. Порядок — как в общем списке (по ФИО).
 */
export function admissionRoster<T extends { id: string }>(
  pointPeople: readonly T[],
  everyone: readonly T[],
  markedIds: ReadonlySet<string>,
): T[] {
  const inPoint = new Map(pointPeople.map((person) => [person.id, person]));
  const rows: T[] = [];
  for (const person of everyone) {
    const own = inPoint.get(person.id);
    if (own) rows.push(own);
    else if (markedIds.has(person.id)) rows.push(person);
  }
  return rows;
}
