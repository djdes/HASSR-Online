/**
 * «Загрузить из справочника» (пункт 1.5 структуры ППК): готовая продукция и
 * полуфабрикаты справочника продукции → карточки описания продукции. Уже
 * описанные (по названию без учёта регистра) не дублируются, лимит блока
 * соблюдается. Чистый модуль: без БД.
 */
import { productIndicatorPreset } from "./haccp-presets";
import type { ProductData } from "./records";

export type DirectoryProduct = {
  name: string;
  kind: string;
  storageTemp: string | null;
  storageConditions: string | null;
  shelfLifeDays: number | null;
  shelfLifeHours: number | null;
};

/** Какие виды справочника идут в «Перечень выпускаемой продукции». */
export const IMPORTED_PRODUCT_KINDS = ["finished", "semi"] as const;

const clip = (value: string, max = 200) => value.replace(/\s+/g, " ").trim().slice(0, max);

function shelfLife(product: DirectoryProduct): string {
  if (product.shelfLifeHours && product.shelfLifeHours > 0) return `${product.shelfLifeHours} ч`;
  if (product.shelfLifeDays && product.shelfLifeDays > 0) return `${product.shelfLifeDays} сут.`;
  return "";
}

export function productsFromDirectory(
  directory: DirectoryProduct[],
  existingNames: string[],
  room: number,
): ProductData[] {
  const taken = new Set(existingNames.map((name) => clip(name).toLowerCase()));
  const out: ProductData[] = [];
  for (const product of directory) {
    if (out.length >= room) break;
    if (!(IMPORTED_PRODUCT_KINDS as readonly string[]).includes(product.kind)) continue;
    const name = clip(product.name);
    if (!name || taken.has(name.toLowerCase())) continue;
    taken.add(name.toLowerCase());
    const category = product.kind === "semi" ? "semi-finished" : "ready-meals";
    out.push({
      name,
      category,
      composition: "",
      storage: clip([product.storageTemp, product.storageConditions].filter(Boolean).join(", ")),
      shelfLife: shelfLife(product),
      usage: "",
      packaging: "",
      indicators: productIndicatorPreset(category),
    });
  }
  return out;
}
