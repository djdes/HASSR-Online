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
  /**
   * Выбрана «Вся организация» (2026-10-28): офис или пункт «Вся организация»
   * в шапке. Данные по-прежнему пишутся в `activeBuildingId` (офис, а без
   * офиса — первая точка), меняется только режим раздела «Журналы».
   */
  organizationView: boolean;
  /** Человек может выбрать «Вся организация»: руководство на всю компанию. */
  canViewOrganization: boolean;
  /** Раздел «Журналы» в режиме точки — см. `journalsPointMode`. */
  pointMode: boolean;
};

const DISABLED_CONTEXT: BuildingContext = {
  enabled: false,
  buildings: [],
  activeBuildingId: null,
  activeBuilding: null,
  canSwitch: false,
  organizationView: true,
  canViewOrganization: false,
  pointMode: false,
};

/**
 * Значение cookie / `lastActiveBuildingId` для «Вся организация». Id точек —
 * cuid, совпасть с этим словом не могут.
 */
export const ORGANIZATION_VIEW_ID = "organization";

/**
 * Раздел «Журналы» в режиме точки (2026-10-28, владелец): в шапке выбрана
 * торговая точка — «Журналы точек» и «Все журналы» закрыты, вход в раздел —
 * «Сегодня». Руководитель точки (закреплён только за своими точками) в нём
 * всегда. Режим — только у руководящего звена (руководство, заведующая):
 * линейному сотруднику «Все журналы» — единственный вход в журналы на сайте.
 * Точки выключены или одна — режима нет.
 */
export function journalsPointMode(context: Pick<BuildingContext, "pointMode">): boolean {
  return context.pointMode;
}

/**
 * Торговая точка, на которую человек смотрит (шапка): цеха, оборудование и
 * QR — только её объекты (сканы 98, 2026-10-28). null — вся организация:
 * выбраны «Вся организация» или офис, точки выключены. Документы при этом
 * по-прежнему пишутся в `activeBuildingId`.
 */
export function viewedPointId(
  context: Pick<BuildingContext, "enabled" | "organizationView" | "activeBuildingId">,
): string | null {
  return context.enabled && !context.organizationView ? context.activeBuildingId : null;
}

/**
 * Точки, по которым собираются задачи дня («Сегодня», «Проверка записей»,
 * панель заведующей), 2026-10-31: на точке — только её холодильники,
 * помещения, документы и люди.
 *  - точки выключены — `[null]`, вся организация как раньше;
 *  - человек смотрит на торговую точку — только она;
 *  - руководство в режиме «Вся организация» — все точки, каждая отдельно;
 *  - сотрудник офиса — офис.
 */
export function poolBuildingsFromContext(
  context: Pick<BuildingContext, "enabled" | "organizationView" | "canViewOrganization" | "activeBuildingId" | "buildings">,
): Array<{ id: string | null; name: string | null }> {
  if (!context.enabled || !context.activeBuildingId) return [{ id: null, name: null }];
  const named = (id: string) => ({ id, name: context.buildings.find((building) => building.id === id)?.name ?? null });
  const viewed = viewedPointId(context);
  if (viewed) return [named(viewed)];
  if (context.canViewOrganization && context.buildings.length > 0) {
    return context.buildings.map((building) => ({ id: building.id, name: building.name }));
  }
  return [named(context.activeBuildingId)];
}

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

/**
 * Работает ли сотрудник на точке объекта (холодильник, склад, документ
 * журнала) — кто попадает в «Кто заполняет» на QR и кому можно записать.
 * Правила `workBuildingsForUser`: пустой `buildingIds` — везде; в списке
 * только удалённые точки — тоже везде; сотрудник офиса работает в офисе,
 * а не на торговой точке. `orgBuildingIds` — точки организации.
 */
export function worksAtBuilding(
  orgBuildingIds: readonly string[],
  userBuildingIds: readonly string[],
  buildingId: string,
): boolean {
  if (userBuildingIds.length === 0) return true;
  const known = userBuildingIds.filter((id) => orgBuildingIds.includes(id));
  return known.length === 0 || known.includes(buildingId);
}

/** Точка для правил «где работает»: хватает id и вида. */
export type BuildingKindRef = { id: string; kind?: string };

/**
 * Руководитель точки (фаза 2 «Офис и точки», 2026-10-27): организация
 * работает по точкам, у неё есть офис, а человек закреплён только за
 * торговыми точками. Возвращает id его точек; `null` — человек работает
 * на всю компанию (офис, без места, офиса нет, точки выключены или в
 * списке остались только удалённые точки).
 */
export function pointScopeForUser(args: {
  enabled: boolean;
  buildings: readonly BuildingKindRef[];
  userBuildingIds: readonly string[];
}): string[] | null {
  if (!args.enabled || args.userBuildingIds.length === 0) return null;
  if (!args.buildings.some(isOfficeBuilding)) return null;
  const wanted = new Set(args.userBuildingIds);
  const subset = args.buildings.filter((building) => wanted.has(building.id));
  if (subset.length === 0 || subset.some(isOfficeBuilding)) return null;
  return subset.map((building) => building.id);
}

/**
 * Получает ли человек уведомление (фаза 3): событие точки — люди этой
 * точки и вся компания (офис, без места); общее событие (`buildingId`
 * пуст) — только компания, руководителю точки чужие и общие дела не шлём.
 * `onlyPlace` — только люди самой точки: частые напоминания офис получает
 * одной сводкой по всем точкам, а не по сообщению на точку. В организации
 * без офиса — как раньше: общее всем, событие точки — тем, кто на ней
 * работает (пустой `buildingIds` — везде).
 */
export function receivesPlaceEvent(args: {
  enabled: boolean;
  buildings: readonly BuildingKindRef[];
  userBuildingIds: readonly string[];
  buildingId: string | null | undefined;
  onlyPlace?: boolean;
}): boolean {
  if (!splitsOfficeAndPoints(args)) {
    return !args.buildingId || args.userBuildingIds.length === 0 || args.userBuildingIds.includes(args.buildingId);
  }
  const scope = pointScopeForUser(args);
  if (!args.buildingId) return scope === null;
  if (args.onlyPlace) return args.userBuildingIds.includes(args.buildingId);
  return scope === null || scope.includes(args.buildingId);
}

/** Организация делит офис и точки: точки включены и офис выделен. */
export function splitsOfficeAndPoints(args: { enabled: boolean; buildings: readonly BuildingKindRef[] }): boolean {
  return args.enabled && args.buildings.some(isOfficeBuilding);
}

export function resolveActiveBuilding(args: {
  enabled: boolean;
  buildings: BuildingOption[];
  userBuildingIds: readonly string[];
  cookieBuildingId: string | null;
  /** Руководство (`hasFullWorkspaceAccess`): ему доступна «Вся организация». */
  fullAccess?: boolean;
}): BuildingContext {
  if (!args.enabled || args.buildings.length < 2) return DISABLED_CONTEXT;
  const buildings = allowedBuildingsForUser(args.buildings, args.userBuildingIds);
  // «Вся организация» — руководству, которое работает на всю компанию (видит
  // все точки); руководитель точки всегда смотрит свою точку.
  const canViewOrganization = args.fullAccess === true && buildings.length === args.buildings.length;
  const office = buildings.find(isOfficeBuilding) ?? null;
  // Без выбора руководство начинает со всей организации (корень «Журналов» —
  // «Журналы точек»), остальные — с первой своей точки, как раньше.
  const wantsOrganization =
    canViewOrganization && (args.cookieBuildingId === ORGANIZATION_VIEW_ID || args.cookieBuildingId === null);
  const active = wantsOrganization
    ? (office ?? buildings[0])
    : (buildings.find((building) => building.id === args.cookieBuildingId) ?? buildings[0]);
  const organizationView = wantsOrganization || isOfficeBuilding(active);
  return {
    enabled: true,
    buildings,
    activeBuildingId: active.id,
    activeBuilding: active,
    canSwitch: buildings.length >= 2,
    organizationView,
    canViewOrganization,
    pointMode: args.fullAccess === true && !organizationView,
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

export type EquipmentBuildingWhere = {
  OR?: Array<{ area: { buildingId: string | null } }>;
};

/**
 * Оборудование точки — как список на странице «Оборудование»: цеха этой
 * точки и цеха без точки (сканы 98, 2026-10-28: «нажатие выводит всё
 * оборудование организации, а должно только этой торговой точки»).
 * `null` — без фильтра. Разворачивается в `where` через spread.
 */
export function equipmentBuildingWhere(buildingId: string | null | undefined): EquipmentBuildingWhere {
  return buildingId ? { OR: [{ area: { buildingId } }, { area: { buildingId: null } }] } : {};
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
