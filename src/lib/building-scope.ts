/**
 * Точки (2026-09-05): чистые функции области точки — без Prisma и
 * без `next/headers`, чтобы их можно было гонять в `node --test`.
 *
 * Точка = `Building`. Документы журналов получают `buildingId`, активная
 * точка живёт в cookie `wesetup.building` = `<orgId>:<buildingId>`.
 * Префикс организации делает значение бессмысленным после смены
 * организации, импёрсонации ROOT или входа партнёра в другой кабинет:
 * оно просто не совпадает и игнорируется.
 *
 * Серверная обвязка (cookies, БД, кэш на запрос) — в
 * `src/lib/active-building.ts`. Дизайн:
 * docs/superpowers/specs/2026-09-05-locations-design.md
 */

export const ACTIVE_BUILDING_COOKIE = "wesetup.building";

/** Год: точку выбирают редко, а терять выбор при каждом входе неприятно. */
export const ACTIVE_BUILDING_COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;

export type BuildingOption = {
  id: string;
  name: string;
  address: string | null;
  /** "office" — офис организации, иначе (или не задано) — торговая точка. */
  kind?: string;
};

/** Вид `Building` для офиса организации (2026-10-26). */
export const OFFICE_BUILDING_KIND = "office";

export function isOfficeBuilding(building: object | null | undefined): boolean {
  return (building as { kind?: unknown } | null | undefined)?.kind === OFFICE_BUILDING_KIND;
}

export type BuildingContext = {
  /** Точки включены и их ≥ 2 — документы делятся по точкам. */
  enabled: boolean;
  /** Точки, доступные пользователю (с учётом `User.buildingIds`). */
  buildings: BuildingOption[];
  activeBuildingId: string | null;
  activeBuilding: BuildingOption | null;
  /** Показывать переключатель: доступных точек ≥ 2. */
  canSwitch: boolean;
};

const DISABLED_CONTEXT: BuildingContext = {
  enabled: false,
  buildings: [],
  activeBuildingId: null,
  activeBuilding: null,
  canSwitch: false,
};

export function encodeBuildingCookie(orgId: string, buildingId: string): string {
  return `${orgId}:${buildingId}`;
}

/** Id точки из cookie, если она записана для этой организации; иначе null. */
export function decodeBuildingCookie(
  raw: string | null | undefined,
  orgId: string,
): string | null {
  if (!raw) return null;
  const separator = raw.indexOf(":");
  if (separator <= 0) return null;
  if (raw.slice(0, separator) !== orgId) return null;
  const buildingId = raw.slice(separator + 1).trim();
  return buildingId || null;
}

/**
 * Точки, которые сотрудник видит (переключатель, «Мои точки», страницы
 * точек). Пустой `buildingIds` = все. Сотрудник офиса видит все точки
 * компании. Если в списке остались только удалённые точки — тоже все:
 * висящие id не должны отрезать человека от журналов (тот же принцип,
 * что у `cleanIds` в cleaning-room-responsibles.ts).
 */
export function allowedBuildingsForUser(
  buildings: BuildingOption[],
  userBuildingIds: readonly string[],
): BuildingOption[] {
  if (userBuildingIds.length === 0) return buildings;
  const wanted = new Set(userBuildingIds);
  const subset = buildings.filter((building) => wanted.has(building.id));
  if (subset.some(isOfficeBuilding)) return buildings;
  return subset.length > 0 ? subset : buildings;
}

/**
 * Точки, где сотрудник работает: строки кадровых журналов, обязательства,
 * задачи. В отличие от `allowedBuildingsForUser`, сотрудник офиса работает
 * только в офисе — точки он видит, но их журналы ведут люди точки.
 */
export function workBuildingsForUser(
  buildings: BuildingOption[],
  userBuildingIds: readonly string[],
): BuildingOption[] {
  if (userBuildingIds.length === 0) return buildings;
  const wanted = new Set(userBuildingIds);
  const subset = buildings.filter((building) => wanted.has(building.id));
  return subset.length > 0 ? subset : buildings;
}

export function resolveActiveBuilding(args: {
  enabled: boolean;
  buildings: BuildingOption[];
  userBuildingIds: readonly string[];
  cookieBuildingId: string | null;
}): BuildingContext {
  if (!args.enabled || args.buildings.length < 2) return DISABLED_CONTEXT;
  const buildings = allowedBuildingsForUser(args.buildings, args.userBuildingIds);
  const active =
    buildings.find((building) => building.id === args.cookieBuildingId) ??
    buildings[0];
  return {
    enabled: true,
    buildings,
    activeBuildingId: active.id,
    activeBuilding: active,
    canSwitch: buildings.length >= 2,
  };
}

export type BuildingWhere = {
  OR?: Array<{ buildingId: string | null }>;
};

/**
 * Фильтр документов/обязательств для точки: свои + общие (без точки).
 * Общие документы созданы до включения точек — они видны на каждой
 * точке, и тот же предикат служит guard'ом автосоздания: пока жив общий
 * документ периода, новые по точкам не создаются, а со следующего
 * периода документы рождаются на каждую точку. `null` — без фильтра.
 *
 * Разворачивается в `where` через spread; у запросов, куда он
 * подставляется, своего `OR` нет.
 */
export function buildingWhere(buildingId: string | null | undefined): BuildingWhere {
  return buildingId ? { OR: [{ buildingId }, { buildingId: null }] } : {};
}

/**
 * Подпись точки в шапке журнала: наименование для журналов, если задано
 * (точное юридическое по месту деятельности), иначе «Точка 2, ул. Ленина, 5»
 * или просто «Точка 2». В интерфейсе точка остаётся под коротким `name`.
 */
export function buildingLabel(
  building: { name: string; address?: string | null; journalName?: string | null } | null | undefined,
): string {
  if (!building) return "";
  const journalName = building.journalName?.replace(/\s+/g, " ").trim();
  if (journalName) return journalName;
  const address = building.address?.trim();
  return address ? `${building.name}, ${address}` : building.name;
}

/**
 * Имя точки в списках для инспектора (архив проверки, PDF портала): наименование
 * для журналов, иначе короткое название — без адреса, чтобы строка списка не
 * разрасталась.
 */
export function buildingPrintName(
  building: { name: string; journalName?: string | null } | null | undefined,
): string {
  if (!building) return "";
  const journalName = building.journalName?.replace(/\s+/g, " ").trim();
  return journalName || building.name;
}

/** Название организации с точкой для шапки документа и PDF. */
export function withBuildingLabel(
  organizationName: string,
  building: { name: string; address?: string | null; journalName?: string | null } | null | undefined,
): string {
  const label = buildingLabel(building);
  return label ? `${organizationName} · ${label}` : organizationName;
}

/** Заголовок задачи TasksFlow с точкой: «Уборка · Кухня · Точка 2». */
export function withBuildingSuffix(
  title: string,
  buildingName: string | null | undefined,
): string {
  const name = buildingName?.trim();
  return name ? `${title} · ${name}` : title;
}
