/**
 * Poster → WeSetup (спека pos-menu-poster-2026-11-21, Р3): поставка — во
 * «Входящие накладные» (дальше та же приёмка, что у УПД и iiko), ручное
 * списание — в «Потери», меню и ингредиенты — в справочник продуктов с видом
 * продукции. Чистые функции.
 */
import type { ProductKind } from "@/lib/product-kinds";

import type { IikoLoss } from "./iiko-map";
import type {
  PosterIngredient,
  PosterProduct,
  PosterSupplier,
  PosterSupply,
  PosterSupplyItem,
  PosterWasteDetail,
} from "./poster";
import type { ParsedUpd, SupplyItem } from "./upd";

export type PosterDirectory = {
  products: Map<string, PosterProduct>;
  ingredients: Map<string, PosterIngredient>;
  suppliers: Map<string, PosterSupplier>;
};

export function buildPosterDirectory(
  products: PosterProduct[],
  ingredients: PosterIngredient[],
  suppliers: PosterSupplier[],
): PosterDirectory {
  return {
    products: new Map(products.map((product) => [product.id, product])),
    ingredients: new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])),
    suppliers: new Map(suppliers.map((supplier) => [supplier.id, supplier])),
  };
}

/** Единицы Poster (kg, p, l) — как в накладных и справочнике: «кг», «шт», «л». */
const UNIT_LABELS: Readonly<Record<string, string>> = { kg: "кг", p: "шт", pcs: "шт", l: "л", g: "г", ml: "мл" };

export function posterUnitLabel(unit: string | null | undefined): string | null {
  const key = (unit ?? "").trim().toLowerCase();
  if (!key) return null;
  return UNIT_LABELS[key] ?? key;
}

/** Поставка Poster в том же виде, что разобранный УПД; null — удалена или без строк. */
export function posterSupplyToDocument(
  supply: PosterSupply,
  items: PosterSupplyItem[],
  supplier: PosterSupplier | null | undefined,
): ParsedUpd | null {
  if (supply.deleted) return null;
  const rows: SupplyItem[] = items.map((item, index) => ({
    line: index + 1,
    name: item.name,
    unit: posterUnitLabel(item.unit),
    quantity: item.amount,
    price: item.sumRub !== null && item.amount ? Math.round((item.sumRub / item.amount) * 100) / 100 : null,
    amount: item.sumRub,
    code: item.ingredientId,
    expiryDate: null,
  }));
  if (rows.length === 0) return null;
  const sums = rows.map((row) => row.amount).filter((value): value is number => value !== null);
  return {
    kind: "invoice",
    function: "",
    formatVersion: null,
    // У поставки Poster нет номера поставщика — номер поставки в Poster.
    number: supply.id,
    date: supply.date,
    seller: { name: supplier?.name ?? supply.supplierName ?? "Поставщик из Poster", inn: supplier?.inn ?? null, kpp: null },
    buyer: null,
    items: rows,
    total: sums.length === rows.length ? Math.round(sums.reduce((a, b) => a + b, 0) * 100) / 100 : null,
    basis: null,
    shippedDate: supply.date,
  };
}

/** Тот же вид строки потерь, что у iiko; ключ без дублей — `poster:<списание>:<позиция>`. */
export type PosterLoss = IikoLoss;

export function posterLossId(wasteId: string, position: number): string {
  return `poster:${wasteId}:${position}`;
}

const INGREDIENT_ELEMENT = 10;

/**
 * Ручное списание Poster → строки «Потерь»: по позиции списания. Ингредиент —
 * его вес и единица; товар, блюдо, полуфабрикат — количество в штуках.
 * Стоимость — сумма себестоимости ингредиентов позиции. Позиция, которую не
 * назвать по справочнику, пропускается.
 */
export function posterWasteToLosses(waste: PosterWasteDetail, dir: PosterDirectory): PosterLoss[] {
  if (waste.deleted) return [];
  const cause = waste.reason ?? "Списание в Poster";
  return waste.elements.flatMap((element, index) => {
    const first = element.ingredients[0];
    const ingredientName = (id: string | null | undefined) => (id ? dir.ingredients.get(id)?.name ?? null : null);
    const isIngredient = element.type === INGREDIENT_ELEMENT;
    const name = isIngredient
      ? ingredientName(first?.ingredientId) ?? ingredientName(element.productId)
      : (element.productId ? dir.products.get(element.productId)?.name ?? null : null) ?? ingredientName(first?.ingredientId);
    if (!name) return [];
    const costs = element.ingredients.map((item) => item.costRub).filter((value): value is number => value !== null);
    const weight = element.ingredients.reduce((total, item) => total + (item.weight ?? 0), 0);
    return [
      {
        sourceEntryId: posterLossId(waste.id, index + 1),
        date: waste.date,
        productName: name,
        quantity: isIngredient ? Math.round(weight * 1000) / 1000 : element.count ?? 0,
        unit: isIngredient ? posterUnitLabel(first?.unit) ?? "шт" : "шт",
        costRub: costs.length > 0 ? Math.round(costs.reduce((a, b) => a + b, 0) * 100) / 100 : null,
        cause,
      },
    ];
  });
}

/** Позиция меню Poster → вид продукции справочника (Р3). */
const PRODUCT_KINDS: Readonly<Record<string, ProductKind>> = { dish: "finished", semi: "semi", product: "raw" };

/**
 * Меню и ингредиенты Poster → справочник продуктов: блюда — готовая
 * продукция (подсказки бракеража и раздачи), полуфабрикаты — полуфабрикаты,
 * товары и ингредиенты — сырьё. Скрытые из меню не берём; без повторов по
 * имени (меню — первым).
 */
export function posterProductsForDirectory(
  products: PosterProduct[],
  ingredients: PosterIngredient[],
): Array<{ name: string; unit: string | null; kind: ProductKind }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; unit: string | null; kind: ProductKind }> = [];
  const push = (name: string, unit: string | null, kind: ProductKind) => {
    const key = name.trim().toLocaleLowerCase("ru");
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name: name.trim(), unit, kind });
  };
  for (const product of products) {
    const kind = product.type ? PRODUCT_KINDS[product.type] : undefined;
    if (product.hidden || !kind) continue;
    // Блюдо без единицы в Poster — порция, «шт».
    push(product.name, posterUnitLabel(product.unit) ?? (kind === "finished" ? "шт" : null), kind);
  }
  for (const ingredient of ingredients) push(ingredient.name, posterUnitLabel(ingredient.unit), "raw");
  return out;
}
