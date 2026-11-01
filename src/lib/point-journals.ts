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
  const orgDisabled = disabledEverywhere(next);
  return {
    orgDisabled,
    buildings: next.filter((building) => building.changed).map(({ id, disabled }) => ({ id, disabled })),
  };
}

/** Выключено у организации — только то, что выключено на всех точках. */
function disabledEverywhere(sets: readonly { disabled: readonly string[] }[]): string[] {
  return [...new Set(sets.flatMap((building) => building.disabled))].filter((entry) =>
    sets.every((building) => building.disabled.includes(entry)),
  );
}

function sameCodes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((code) => b.includes(code));
}

/**
 * Записать весь набор («Настройка журналов», 2026-11-01). `target` — точка
 * из шапки (`viewedPointId`):
 *  - точка — меняется только её набор; точкам, жившим набором организации,
 *    копируется их текущий набор (как `planPointJournalToggle`);
 *  - null — вся организация: что включили или выключили относительно набора
 *    организации, меняется у организации и у каждой точки со своим набором.
 *    Раньше правка «всей организации» уходила в набор офиса или первой точки.
 */
export function planJournalSetWrite(
  sets: PointJournalSets,
  target: string | null,
  nextDisabled: readonly string[],
): PointJournalPlan {
  const desired = [...new Set(nextDisabled)];
  if (target) {
    if (!sets.buildings.some((building) => building.id === target)) {
      throw new Error(`Точка ${target} не найдена`);
    }
    const next = sets.buildings.map((building) => ({
      id: building.id,
      disabled: building.id === target ? desired : [...(building.disabled ?? sets.orgDisabled)],
      changed: building.id === target || building.disabled === null,
    }));
    return {
      orgDisabled: disabledEverywhere(next),
      buildings: next.filter((building) => building.changed).map(({ id, disabled }) => ({ id, disabled })),
    };
  }
  const turnedOff = desired.filter((code) => !sets.orgDisabled.includes(code));
  const turnedOn = new Set(sets.orgDisabled.filter((code) => !desired.includes(code)));
  const own = sets.buildings
    .filter((building) => building.disabled !== null)
    .map((building) => ({
      id: building.id,
      disabled: [...new Set([...(building.disabled ?? []), ...turnedOff])].filter((code) => !turnedOn.has(code)),
    }));
  if (own.length === 0) return { orgDisabled: desired, buildings: [] };
  const inherited = sets.buildings
    .filter((building) => building.disabled === null)
    .map((building) => ({ id: building.id, disabled: desired }));
  const orgDisabled = disabledEverywhere([...own, ...inherited]);
  // Точки без своего набора живут набором организации: если он станет уже
  // нужного, им записывается свой — иначе у них включились бы лишние журналы.
  return { orgDisabled, buildings: sameCodes(orgDisabled, desired) ? own : [...own, ...inherited] };
}

/** Набор точки после плана: выключенные коды (для ответа API и проверки тарифа). */
export function disabledAfter(plan: PointJournalPlan, sets: PointJournalSets, buildingId: string | null): string[] {
  if (!buildingId) return plan.orgDisabled;
  return (
    plan.buildings.find((building) => building.id === buildingId)?.disabled ??
    [...(sets.buildings.find((building) => building.id === buildingId)?.disabled ?? sets.orgDisabled)]
  );
}
