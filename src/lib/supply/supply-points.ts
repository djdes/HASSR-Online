import { viewedPointId } from "@/lib/building-scope";

/**
 * Поставки по точкам (2026-11-01): накладная, потеря и этикетка знают свою
 * торговую точку. Чистые функции — БД и сеть передаёт вызывающий.
 *
 *  - УПД: точка — по КПП грузополучателя (иначе покупателя), если он есть
 *    ровно у одной точки организации; иначе точку выбирают при приёмке.
 *  - iiko: у каждого склада сервера — точка, «не загружать» или ничего.
 */

/** Значение «не загружать» в сопоставлении складов iiko. */
export const IIKO_STORE_SKIP = "skip";

export type IikoStoreView = { id: string; name: string; department: string | null };

export type IikoStorePoints = {
  stores: IikoStoreView[];
  /** storeId → id точки или {@link IIKO_STORE_SKIP}. */
  map: Record<string, string>;
};

function digits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * Точка по КПП: первая сторона с КПП, который стоит ровно у одной точки.
 * У сети с одним юрлицом КПП у всех точек обычно одинаковый — тогда null.
 */
export function pointByKpp(
  parties: ReadonlyArray<{ kpp?: string | null } | null | undefined>,
  buildings: ReadonlyArray<{ id: string; kpp?: string | null }>,
): string | null {
  for (const party of parties) {
    const kpp = digits(party?.kpp);
    if (kpp.length !== 9) continue;
    const matches = buildings.filter((building) => digits(building.kpp) === kpp);
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) return null;
  }
  return null;
}

/** Сохранённое сопоставление складов; мусор — пустое. */
export function readIikoStorePoints(value: unknown): IikoStorePoints {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const stores = Array.isArray(record.stores)
    ? record.stores.flatMap((raw) => {
        const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
        if (!item || typeof item.id !== "string" || typeof item.name !== "string") return [];
        return [{ id: item.id, name: item.name, department: typeof item.department === "string" ? item.department : null }];
      })
    : [];
  const rawMap = record.map && typeof record.map === "object" && !Array.isArray(record.map) ? (record.map as Record<string, unknown>) : {};
  const map: Record<string, string> = {};
  for (const [storeId, target] of Object.entries(rawMap)) {
    if (typeof target === "string" && target) map[storeId] = target;
  }
  return { stores, map };
}

/** Склады с названиями подразделений: «Кафе на Ленина — Склад кухни». */
export function iikoStoreViews(
  stores: ReadonlyArray<{ id: string; name: string; parentId: string | null }>,
  departments: ReadonlyArray<{ id: string; name: string }>,
): IikoStoreView[] {
  const departmentName = new Map(departments.map((department) => [department.id, department.name]));
  return stores
    .map((store) => ({ id: store.id, name: store.name, department: store.parentId ? departmentName.get(store.parentId) ?? null : null }))
    .sort((a, b) => `${a.department ?? ""} ${a.name}`.localeCompare(`${b.department ?? ""} ${b.name}`, "ru"));
}

/**
 * Что делать с документом склада: пропустить («не загружать») или сохранить с
 * точкой. Точка, которой больше нет, и склад без сопоставления — без точки.
 */
export function iikoStoreDecision(
  storeId: string | null,
  map: Readonly<Record<string, string>>,
  livePointIds: ReadonlySet<string>,
): { skip: boolean; buildingId: string | null } {
  const target = storeId ? map[storeId] : undefined;
  if (target === IIKO_STORE_SKIP) return { skip: true, buildingId: null };
  return { skip: false, buildingId: target && livePointIds.has(target) ? target : null };
}

/**
 * Точка приёмки: при включённых точках обязательна и должна быть среди
 * доступных человеку; при выключенных — всегда null.
 */
export function resolveAcceptancePoint(args: {
  pointsEnabled: boolean;
  requested: string | null | undefined;
  allowedPointIds: ReadonlyArray<string>;
}): { ok: true; buildingId: string | null } | { ok: false; error: "point_required" | "point_forbidden" } {
  if (!args.pointsEnabled) return { ok: true, buildingId: null };
  if (!args.requested) return { ok: false, error: "point_required" };
  return args.allowedPointIds.includes(args.requested)
    ? { ok: true, buildingId: args.requested }
    : { ok: false, error: "point_forbidden" };
}

/**
 * Накладные по точкам (2026-11-01): что человек видит во «Входящих» и какие
 * накладные может открыть и принять.
 *
 *  - точки выключены — всё как раньше;
 *  - на торговой точке — её накладные и накладные без точки;
 *  - «Вся организация» — все накладные доступных точек и без точки;
 *  - накладную другой точки человек, привязанный к точкам, не открывает.
 */
export type SupplyPointAccess = {
  enabled: boolean;
  /** Точки, доступные человеку (для выбора точки приёмки). */
  points: Array<{ id: string; name: string }>;
  /** Торговая точка из шапки; null — «Вся организация» или точки выключены. */
  viewedPointId: string | null;
  canSee(buildingId: string | null): boolean;
  /** Условие для `supplyDocument.findMany`; занимает верхний `OR`. */
  listWhere: { OR?: Array<{ buildingId: string | null } | { buildingId: { in: string[] } }> };
  /** Какие накладные человек может открыть: доступные точки и без точки; верхний `OR`. */
  seeWhere: { OR?: Array<{ buildingId: string | null } | { buildingId: { in: string[] } }> };
};

export function supplyPointAccessFrom(context: {
  enabled: boolean;
  organizationView: boolean;
  activeBuildingId: string | null;
  buildings: ReadonlyArray<{ id: string; name: string }>;
}): SupplyPointAccess {
  if (!context.enabled) {
    return { enabled: false, points: [], viewedPointId: null, canSee: () => true, listWhere: {}, seeWhere: {} };
  }
  const points = context.buildings.map((building) => ({ id: building.id, name: building.name }));
  const allowed = new Set(points.map((point) => point.id));
  const viewed = viewedPointId(context);
  const seeWhere = { OR: [{ buildingId: { in: [...allowed] } }, { buildingId: null }] };
  return {
    enabled: true,
    points,
    viewedPointId: viewed,
    canSee: (buildingId) => buildingId === null || allowed.has(buildingId),
    listWhere: viewed ? { OR: [{ buildingId: viewed }, { buildingId: null }] } : seeWhere,
    seeWhere,
  };
}
