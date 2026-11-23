import { normalizeSphere, type OrgSphere } from "@/lib/org-profile";

/**
 * Сферы объектов (владелец, 2026-11-23): «сферу указываем при создании
 * объекта, только 4 на выбор: Общепит ХАССП, Медицинские услуги, Услуги
 * потребителям, Спорт и рекреация» и «объекты завязываем на категориях, у
 * организации».
 *
 * Категория живёт у объекта (`Building.sphere`). Набор журналов, права и
 * юридические подсказки по-прежнему считает таблица сфер
 * (`sphere-journal-rules.ts`): у каждой категории — своя сфера правил. Старые
 * сферы организаций (кафе, столовая, школа…) остаются в `Organization.type` и
 * показываются своей категорией — выбор той же категории их не переписывает
 * (`resolveSphereForCategory`), чтобы у школы не пропали её требования.
 *
 * Модуль чистый: его берут API, страницы, клиент и тесты. Подписи — в словарях
 * (`common.objectCategories.<value>`).
 */

export const OBJECT_CATEGORIES = [
  { value: "food", sphere: "restaurant" },
  { value: "medical", sphere: "medical" },
  { value: "consumer", sphere: "beauty" },
  { value: "sport", sphere: "fitness" },
] as const satisfies readonly { value: string; sphere: OrgSphere }[];

export type ObjectCategory = (typeof OBJECT_CATEGORIES)[number]["value"];

/** Значения для `z.enum`. */
export const OBJECT_CATEGORY_VALUES = OBJECT_CATEGORIES.map((category) => category.value) as [
  ObjectCategory,
  ...ObjectCategory[],
];

/**
 * Старая сфера организации → категория. Общепит, производство и магазин —
 * «Общепит ХАССП» (пищевые журналы и ХАССП); отель и салоны — «Услуги
 * потребителям»; «Другое» — без категории.
 */
const SPHERE_CATEGORY: Record<OrgSphere, ObjectCategory | null> = {
  restaurant: "food",
  cafe: "food",
  bar: "food",
  canteen: "food",
  fastfood: "food",
  bakery: "food",
  catering: "food",
  gas_station: "food",
  education: "food",
  production: "food",
  retail: "food",
  hotel: "consumer",
  beauty: "consumer",
  medical: "medical",
  fitness: "sport",
  other: null,
};

export function normalizeObjectCategory(value: unknown): ObjectCategory | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return OBJECT_CATEGORIES.some((category) => category.value === v) ? (v as ObjectCategory) : null;
}

/** Категория старой (или любой сохранённой) сферы организации; «Другое» — null. */
export function categoryForSphere(sphere: unknown): ObjectCategory | null {
  return SPHERE_CATEGORY[normalizeSphere(sphere)] ?? null;
}

export function sphereForCategory(category: ObjectCategory): OrgSphere {
  return OBJECT_CATEGORIES.find((item) => item.value === category)?.sphere ?? "other";
}

/**
 * Сфера правил при выборе категории: сфера организации, если она уже этой
 * категории («Школа» остаётся школой при выборе «Общепит ХАССП»), иначе —
 * сфера категории.
 */
export function resolveSphereForCategory(currentSphere: unknown, category: ObjectCategory): OrgSphere {
  const current = normalizeSphere(currentSphere);
  return categoryForSphere(current) === category ? current : sphereForCategory(category);
}

/** Категория объекта: своя, иначе — основная категория организации. */
export function effectiveObjectCategory(objectSphere: unknown, organizationSphere: unknown): ObjectCategory | null {
  return normalizeObjectCategory(objectSphere) ?? categoryForSphere(organizationSphere);
}

/**
 * Сферы правил организации: основная сфера и сферы объектов других
 * категорий, без повторов. Объект той же категории, что основная, добавляет
 * основную сферу (точную, например «Школа»), а не общую «Общепит».
 */
export function organizationRuleSpheres(
  organizationSphere: unknown,
  objectCategories: readonly unknown[],
): OrgSphere[] {
  const main = normalizeSphere(organizationSphere);
  const mainCategory = categoryForSphere(main);
  const categories = objectCategories
    .map((value) => normalizeObjectCategory(value))
    .filter((value): value is ObjectCategory => value !== null);
  const out: OrgSphere[] = [];
  const add = (sphere: OrgSphere) => {
    if (!out.includes(sphere)) out.push(sphere);
  };
  // «Другое» без объектов с категорией — остаётся «Другое»; с ними — уступает им.
  if (main !== "other" || categories.length === 0) add(main);
  for (const category of categories) add(category === mainCategory ? main : sphereForCategory(category));
  return out;
}
