import { sectionForPath } from "@/lib/app-nav";
import { isOfficeBuilding, type BuildingContext, type BuildingOption } from "@/lib/building-scope";
import { HOME_HREF } from "@/lib/home-page";
import { COMPANY_WIDE_SECTIONS, isCompanyWidePath, normalizePath } from "@/lib/point-section-sync";

/**
 * Что стоит в центре шапки кабинета (эскиз руководителя 2026-10-18: слева —
 * логотип и название компании, в центре — «наименование объекта /
 * текущего объекта»). Название компании в центре не повторяем никогда: два
 * одинаковых названия рядом руководитель назвал «интуитивно не понятно».
 *
 * Модуль без React: решение принимает сервер (layout), рисует клиент
 * (`CurrentPointSwitcher`), проверяют тесты.
 */

/**
 * Как назвать точку. `name` / `address` — текст из базы; `main` — точка
 * названа как компания и адреса нет («Основная точка»); `untitled` — нет ни
 * названия, ни адреса («Точка без названия»).
 */
export type HeaderPointTitle =
  | { source: "name" | "address"; text: string }
  | { source: "main" | "untitled"; text: null };

export type HeaderPointOption = {
  id: string;
  title: HeaderPointTitle;
  /** Адрес второй строкой — когда заголовок не сам адрес. */
  address: string | null;
  /** Значок объекта, выбранный в настройках (`lib/building-icons.ts`); нет — по виду. */
  icon?: string;
};

export type HeaderPoint =
  /** Объектов нет и завести их человек не может — центр пуст. */
  | { kind: "none" }
  /** Объектов нет, человек может их завести — «Выберите объект», в списке «Создать объект». */
  | { kind: "add" }
  /** Один объект (или журналы по объектам и человеку доступен один). */
  | { kind: "single"; point: HeaderPointOption }
  /**
   * Журналы по объектам — переключатель. Офис — не объект (владелец,
   * 2026-11-23): в списке только объекты, без офиса и «Вся организация»;
   * `activeId: null` — выбран уровень организации, на кнопке «Выберите объект».
   * `organizationLevel` — человек может быть на уровне организации (руководство).
   */
  | { kind: "switch"; activeId: string | null; options: HeaderPointOption[]; organizationLevel: boolean }
  /** Объектов несколько, журналы общие — переключать нечего; объекты — в подсказке. */
  | { kind: "all"; count: number; options: HeaderPointOption[] };

// Организационно-правовая форма не делает название другим: «ООО «Берёзка»» и
// «Берёзка» рядом читаются как одно и то же.
const LEGAL_FORMS = new Set(["ооо", "оао", "зао", "пао", "ао", "ип", "llc", "ltd", "mchj", "xk"]);

/** Название для сравнения: без регистра, кавычек, знаков, «ё» и формы собственности. */
export function comparableName(value: string | null | undefined): string {
  return (value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[«»"'„“”‘’`.,()\-–—]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !LEGAL_FORMS.has(word))
    .join(" ");
}

/** Совпадает ли название точки с названием компании (тогда в шапке был бы дубль). */
export function sameAsCompany(pointName: string | null | undefined, companyName: string | null | undefined): boolean {
  const point = comparableName(pointName);
  return point !== "" && point === comparableName(companyName);
}

export function headerPointOption(building: BuildingOption, companyName: string): HeaderPointOption {
  const name = building.name?.replace(/\s+/g, " ").trim() ?? "";
  const address = building.address?.replace(/\s+/g, " ").trim() || null;
  const extra = building.icon ? { icon: building.icon } : {};
  const duplicate = sameAsCompany(name, companyName);
  if (name && !duplicate) return { id: building.id, title: { source: "name", text: name }, address, ...extra };
  if (address) return { id: building.id, title: { source: "address", text: address }, address: null, ...extra };
  return { id: building.id, title: { source: duplicate ? "main" : "untitled", text: null }, address: null, ...extra };
}

export function resolveHeaderPoint(input: {
  /** Название компании — то, что стоит слева вверху. */
  companyName: string;
  /** Все точки организации (без учёта режима «журналы по точкам»). */
  organizationBuildings: BuildingOption[];
  /** Контекст точек запроса (`loadBuildingContext`). */
  context: {
    enabled: boolean;
    buildings: BuildingOption[];
    activeBuildingId: string | null;
    canSwitch: boolean;
    organizationView?: boolean;
    canViewOrganization?: boolean;
  };
  /** Может заводить точки (полный доступ — страница «Объекты»). */
  canManage: boolean;
}): HeaderPoint {
  const { companyName, organizationBuildings, context, canManage } = input;
  // Офис — не объект (владелец, 2026-11-23): ни в списке, ни в подписи.
  const objects = (list: BuildingOption[]) => list.filter((building) => !isOfficeBuilding(building));
  if (context.enabled && context.canSwitch && context.buildings.length >= 2) {
    const options = objects(context.buildings).map((building) => headerPointOption(building, companyName));
    const organizationLevel = context.canViewOrganization === true;
    // Уровень организации (офис или «вся организация») — «Выберите объект».
    const activeId =
      context.organizationView || isOfficeBuilding(context.buildings.find((building) => building.id === context.activeBuildingId))
        ? null
        : options.some((option) => option.id === context.activeBuildingId)
          ? (context.activeBuildingId as string)
          : (options[0]?.id ?? null);
    return { kind: "switch", activeId, options, organizationLevel };
  }
  if (context.enabled && context.activeBuildingId) {
    const active = context.buildings.find((building) => building.id === context.activeBuildingId);
    if (active && !isOfficeBuilding(active)) return { kind: "single", point: headerPointOption(active, companyName) };
  }
  const list = objects(organizationBuildings);
  if (list.length === 0) return canManage ? { kind: "add" } : { kind: "none" };
  if (list.length === 1) {
    return { kind: "single", point: headerPointOption(list[0], companyName) };
  }
  return {
    kind: "all",
    count: list.length,
    options: list.map((building) => headerPointOption(building, companyName)),
  };
}

/** Страницы без своего раздела: главная и список всех точек — про всю компанию. */
const COMPANY_WIDE_PATHS: ReadonlySet<string> = new Set([HOME_HREF, "/settings/buildings"]);

/** Раздел всей компании или список объектов (главная сюда не входит). */
function companySectionPath(path: string): boolean {
  if (path === "/settings/buildings") return true;
  const owner = sectionForPath(path);
  return owner !== null && COMPANY_WIDE_SECTIONS.has(owner.section);
}

/**
 * Прятать ли центр шапки на этом пути.
 *
 * Переключатель (`kind: "switch"`) — на виду везде (владелец, 2026-11-10:
 * после входа руководитель должен видеть его сверху); с 2026-11-11 — и на
 * вкладках с фильтром по местам (`PLACE_FILTER_PATHS`). Один объект и «нет
 * объектов» (2026-11-23) — тоже везде, кроме главной: в разделах всей
 * компании там «Выберите объект». Подпись «Объекты · Все: N» в разделах всей
 * компании и на главной по-прежнему не нужна (сканы 98–99, 2026-10-28).
 */
export function headerPointHidden(pathname: string | null | undefined, kind: HeaderPoint["kind"]): boolean {
  const path = normalizePath(pathname);
  if (kind === "switch") return false;
  if (kind === "none") return true;
  if (path === HOME_HREF) return true;
  if (kind !== "all") return false;
  return COMPANY_WIDE_PATHS.has(path) || companySectionPath(path);
}

/**
 * «Выберите объект» вместо названия (владелец, 2026-11-23: «по умолчанию
 * „Выберите объект“; переходим в офис или пункт меню, где нет объекта, —
 * сверху „Выберите объект“»):
 *   • объектов нет — выбирать нечего, в списке «Создать объект»;
 *   • выбран уровень организации (офис, «вся организация»);
 *   • раздел всей компании — сразу, не дожидаясь автосмены (`PointSectionSync`),
 *     если человек вообще бывает на уровне организации;
 *   • один объект — в разделах всей компании и в списке объектов.
 */
export function headerPointChoosing(pathname: string | null | undefined, point: HeaderPoint): boolean {
  const path = normalizePath(pathname);
  if (point.kind === "add") return true;
  if (point.kind === "switch") return point.activeId === null || (point.organizationLevel && isCompanyWidePath(path));
  if (point.kind === "single") return companySectionPath(path);
  return false;
}

/**
 * Подпись точки в верхней панели Mini App — то же, что в центре шапки сайта
 * (П-3): выбрана «Вся организация» без офиса — так и пишем (раньше там
 * стояла первая точка списка), иначе название выбранной точки или офиса.
 * Точки выключены — подписи нет.
 */
export function miniLocationLabel(
  context: Pick<BuildingContext, "enabled" | "organizationView" | "activeBuilding"> | null,
  organizationLabel: string,
): string | null {
  if (!context?.enabled) return null;
  if (context.organizationView && !isOfficeBuilding(context.activeBuilding)) return organizationLabel;
  return context.activeBuilding?.name ?? null;
}
