import { isOfficeBuilding, type BuildingOption } from "@/lib/building-scope";

/**
 * Что стоит в центре шапки кабинета (эскиз руководителя 2026-10-18: слева —
 * логотип и название компании, в центре — «наименование торговой точки /
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
  /** Офис организации (не торговая точка): подпись «Организация», свой значок. */
  office?: boolean;
};

export type HeaderPoint =
  /** Точек нет и завести их человек не может — центр пуст. */
  | { kind: "none" }
  /** Точек нет, человек может их завести — «+ Добавить точку». */
  | { kind: "add" }
  /** Одна точка (или журналы по точкам и человеку доступна одна). */
  | { kind: "single"; point: HeaderPointOption }
  /** Журналы по точкам и точек две и больше — переключатель. */
  | { kind: "switch"; activeId: string; options: HeaderPointOption[] }
  /** Точек несколько, журналы общие — переключать нечего; точки — в подсказке. */
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
  const office = isOfficeBuilding(building) ? { office: true as const } : {};
  const duplicate = sameAsCompany(name, companyName);
  if (name && !duplicate) return { id: building.id, title: { source: "name", text: name }, address, ...office };
  if (address) return { id: building.id, title: { source: "address", text: address }, address: null, ...office };
  return { id: building.id, title: { source: duplicate ? "main" : "untitled", text: null }, address: null, ...office };
}

export function resolveHeaderPoint(input: {
  /** Название компании — то, что стоит слева вверху. */
  companyName: string;
  /** Все точки организации (без учёта режима «журналы по точкам»). */
  organizationBuildings: BuildingOption[];
  /** Контекст точек запроса (`loadBuildingContext`). */
  context: { enabled: boolean; buildings: BuildingOption[]; activeBuildingId: string | null; canSwitch: boolean };
  /** Может заводить точки (полный доступ — страница «Торговые точки»). */
  canManage: boolean;
}): HeaderPoint {
  const { companyName, organizationBuildings, context, canManage } = input;
  if (context.enabled && context.canSwitch && context.buildings.length >= 2) {
    const options = context.buildings.map((building) => headerPointOption(building, companyName));
    const activeId = options.some((option) => option.id === context.activeBuildingId)
      ? (context.activeBuildingId as string)
      : options[0].id;
    return { kind: "switch", activeId, options };
  }
  if (context.enabled && context.activeBuildingId) {
    const active = context.buildings.find((building) => building.id === context.activeBuildingId);
    if (active) return { kind: "single", point: headerPointOption(active, companyName) };
  }
  if (organizationBuildings.length === 0) return canManage ? { kind: "add" } : { kind: "none" };
  if (organizationBuildings.length === 1) {
    return { kind: "single", point: headerPointOption(organizationBuildings[0], companyName) };
  }
  return {
    kind: "all",
    count: organizationBuildings.length,
    options: organizationBuildings.map((building) => headerPointOption(building, companyName)),
  };
}
