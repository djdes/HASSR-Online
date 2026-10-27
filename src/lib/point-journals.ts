/**
 * «Журналы точек» (`/journals/points`, эскиз 2026-10-28): добавить или убрать
 * журнал одной точке. Чистая логика без БД — её проверяют тесты.
 *
 * Набор журналов хранится выключенными кодами: у организации
 * (`Organization.disabledJournalCodes`) и, если задан, у точки
 * (`Building.disabledJournalCodes`; null — «как у организации»). Точка без
 * своего набора живёт набором организации, поэтому правка одной точки не
 * должна трогать набор организации, пока остальные точки от него зависят:
 * при первой правке всем точкам без своего набора копируется набор
 * организации, а у организации остаются выключенными только журналы,
 * выключенные на всех точках (правило `src/lib/disabled-journals.ts`).
 */

export type PointJournalSets = {
  orgDisabled: readonly string[];
  /** Все точки организации (и офис): свой набор или null. */
  buildings: readonly { id: string; disabled: readonly string[] | null }[];
};

export type PointJournalPlan = {
  orgDisabled: string[];
  /** Точки, которым нужно записать свой набор. */
  buildings: { id: string; disabled: string[] }[];
};

function toggle(disabled: readonly string[], code: string, enabled: boolean): string[] {
  const rest = disabled.filter((entry) => entry !== code);
  return enabled ? rest : [...rest, code];
}

/**
 * План записи: `buildingId = null` — набор всей организации (журналы не
 * делятся по точкам); иначе — набор одной точки, остальные точки не меняются.
 */
export function planPointJournalToggle(
  sets: PointJournalSets,
  buildingId: string | null,
  code: string,
  enabled: boolean,
): PointJournalPlan {
  if (!buildingId) {
    return { orgDisabled: toggle(sets.orgDisabled, code, enabled), buildings: [] };
  }
  if (!sets.buildings.some((building) => building.id === buildingId)) {
    throw new Error(`Точка ${buildingId} не найдена`);
  }
  const next = sets.buildings.map((building) => {
    const own = building.disabled ?? sets.orgDisabled;
    return {
      id: building.id,
      disabled: building.id === buildingId ? toggle(own, code, enabled) : [...own],
      changed: building.id === buildingId || building.disabled === null,
    };
  });
  // Выключен у организации — только журнал, выключенный на всех точках.
  const orgDisabled = [...new Set(next.flatMap((building) => building.disabled))].filter((entry) =>
    next.every((building) => building.disabled.includes(entry)),
  );
  return {
    orgDisabled,
    buildings: next.filter((building) => building.changed).map(({ id, disabled }) => ({ id, disabled })),
  };
}

/** Набор точки после плана: выключенные коды (для ответа API и проверки тарифа). */
export function disabledAfter(plan: PointJournalPlan, sets: PointJournalSets, buildingId: string | null): string[] {
  if (!buildingId) return plan.orgDisabled;
  return (
    plan.buildings.find((building) => building.id === buildingId)?.disabled ??
    [...(sets.buildings.find((building) => building.id === buildingId)?.disabled ?? sets.orgDisabled)]
  );
}
