/**
 * Значок объекта (владелец, 2026-11-22: «иконку объекта дай менять на типовую
 * из нашей базы или загрузить свою»). В `Building.icon` лежит одно из двух:
 *   • ключ из библиотеки ниже (`"school"`, `"coffee"`, …);
 *   • адрес загруженной картинки `/api/org-assets/<org>/building-icon/<id>?v=N`
 *     (файл — в `BuildingIconFile`, раздача — тот же способ, что у логотипа).
 * Пусто — значок по виду: магазин у объекта, здание у офиса.
 *
 * Модуль без React и без БД: его берут сервер, клиент и тесты. Картинки
 * значков — `components/layout/building-icon.tsx`.
 */

/** Библиотека типовых значков: ключ → имя значка lucide. Порядок — как в выборе. */
export const BUILDING_ICON_LIBRARY = [
  { key: "store", lucide: "Store" },
  { key: "cart", lucide: "ShoppingCart" },
  { key: "coffee", lucide: "Coffee" },
  { key: "chef", lucide: "ChefHat" },
  { key: "canteen", lucide: "UtensilsCrossed" },
  { key: "bakery", lucide: "Croissant" },
  { key: "pizza", lucide: "Pizza" },
  { key: "confectionery", lucide: "CakeSlice" },
  { key: "school", lucide: "School" },
  { key: "kindergarten", lucide: "Baby" },
  { key: "college", lucide: "GraduationCap" },
  { key: "hospital", lucide: "Hospital" },
  { key: "hotel", lucide: "Hotel" },
  { key: "camp", lucide: "Tent" },
  { key: "fitness", lucide: "Dumbbell" },
  { key: "factory", lucide: "Factory" },
  { key: "warehouse", lucide: "Warehouse" },
  { key: "delivery", lucide: "Truck" },
  { key: "fuel", lucide: "Fuel" },
  { key: "office", lucide: "Building2" },
] as const;

export type BuildingIconKey = (typeof BUILDING_ICON_LIBRARY)[number]["key"];

export const BUILDING_ICON_KEYS: readonly BuildingIconKey[] = BUILDING_ICON_LIBRARY.map((item) => item.key);

export function isBuildingIconKey(value: unknown): value is BuildingIconKey {
  return typeof value === "string" && (BUILDING_ICON_KEYS as readonly string[]).includes(value);
}

/** Свой значок больше 300 КБ не нужен: в списке он 18–36px. */
export const BUILDING_ICON_MAX_BYTES = 300 * 1024;

/** Сторона квадрата, до которой браузер ужимает картинку перед загрузкой. */
export const BUILDING_ICON_UPLOAD_SIZE = 128;

export const BUILDING_ICON_PATH_PATTERN = /^\/api\/org-assets\/[A-Za-z0-9_-]+\/building-icon\/[A-Za-z0-9_-]+(\?v=\d+)?$/;

export function buildingIconUrl(organizationId: string, buildingId: string, version: number): string {
  return `/api/org-assets/${organizationId}/building-icon/${buildingId}?v=${version}`;
}

export type BuildingIconValue =
  | { kind: "library"; key: BuildingIconKey }
  | { kind: "upload"; url: string };

/**
 * Что лежит в `Building.icon`. Неизвестный ключ или чужой адрес — как пусто:
 * старое значение после удаления значка из библиотеки не ломает список.
 */
export function parseBuildingIcon(value: string | null | undefined): BuildingIconValue | null {
  if (!value) return null;
  if (isBuildingIconKey(value)) return { kind: "library", key: value };
  if (BUILDING_ICON_PATH_PATTERN.test(value)) return { kind: "upload", url: value };
  return null;
}

/** Адрес загруженного значка принадлежит этой точке этой организации. */
export function buildingIconUrlBelongsTo(url: string, organizationId: string, buildingId: string): boolean {
  if (!BUILDING_ICON_PATH_PATTERN.test(url)) return false;
  const [, , , org, , building] = url.split("?")[0].split("/");
  return org === organizationId && building === buildingId;
}
