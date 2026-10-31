import { createHash } from "node:crypto";

/**
 * Справочники для «Сетап помощника» (2026-10-31): подсказки в полях этикеток.
 *
 * Приложение работает без сети, поэтому справочник уходит на телефон целиком
 * и живёт там копией: продукты (срок годности и условия хранения подставляются
 * в этикетку), блюда бракеражного журнала, поставщики и имена сотрудников для
 * «Изготовил». Здесь — только чистая сборка; чтение из БД —
 * `setup-helper-catalog.server.ts`.
 */

export type HelperCatalogProduct = {
  name: string;
  /** Срок годности в часах (из `Product.shelfLifeDays`) или null. */
  shelfLifeHours: number | null;
  /** Условия хранения: «+2…+6 °C». */
  storage: string | null;
  supplier: string | null;
};

export type HelperCatalog = {
  version: string;
  products: HelperCatalogProduct[];
  dishes: string[];
  suppliers: string[];
  staff: string[];
};

/** Поле этикетки — до 60 знаков; длиннее в подсказке не нужно. */
export const CATALOG_NAME_MAX = 80;
export const CATALOG_STORAGE_MAX = 30;
export const CATALOG_LIMITS = { products: 3000, dishes: 2000, suppliers: 500, staff: 1000 } as const;
/** Срок годности дольше двух лет — опечатка, а не срок для этикетки. */
const SHELF_LIFE_DAYS_MAX = 730;

export type CatalogSource = {
  products: Array<{ name: string; shelfLifeDays: number | null; storageTemp: string | null; supplier: string | null }>;
  /** `config` действующих документов бракеража (готовой и скоропортящейся продукции). */
  documents: Array<{ code: string; config: unknown }>;
  staff: Array<{ name: string }>;
};

export const FINISHED_PRODUCT_CODE = "finished_product";
export const PERISHABLE_REJECTION_CODE = "perishable_rejection";

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Имена из `productLists[].items` документа бракеража. */
function listItems(config: unknown): string[] {
  const record = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  const lists = Array.isArray(record.productLists) ? record.productLists : [];
  return lists.flatMap((list) =>
    list && typeof list === "object" ? strings((list as Record<string, unknown>).items) : [],
  );
}

function configField(config: unknown, key: string): unknown {
  return config && typeof config === "object" ? (config as Record<string, unknown>)[key] : undefined;
}

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

/** Без пустых и повторов (без учёта регистра), по алфавиту, не длиннее лимита. */
function uniqueSorted(values: Array<string | null>, limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = clean(value, CATALOG_NAME_MAX);
    if (!text) continue;
    const key = text.toLocaleLowerCase("ru");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out.sort(collator.compare).slice(0, limit);
}

export function shelfLifeHours(days: number | null): number | null {
  if (days === null || !Number.isFinite(days) || days <= 0 || days > SHELF_LIFE_DAYS_MAX) return null;
  return Math.round(days * 24);
}

export function catalogVersion(content: Omit<HelperCatalog, "version">): string {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16);
}

export function buildHelperCatalog(source: CatalogSource): HelperCatalog {
  const products = new Map<string, HelperCatalogProduct>();
  const addProduct = (product: HelperCatalogProduct) => {
    const key = product.name.toLocaleLowerCase("ru");
    const known = products.get(key);
    // Повтор из справочника дополняет пустые поля, но не перетирает заполненные.
    if (known) {
      known.shelfLifeHours ??= product.shelfLifeHours;
      known.storage ??= product.storage;
      known.supplier ??= product.supplier;
      return;
    }
    products.set(key, product);
  };
  for (const row of source.products) {
    const name = clean(row.name, CATALOG_NAME_MAX);
    if (!name) continue;
    addProduct({
      name,
      shelfLifeHours: shelfLifeHours(row.shelfLifeDays),
      storage: clean(row.storageTemp, CATALOG_STORAGE_MAX),
      supplier: clean(row.supplier, CATALOG_NAME_MAX),
    });
  }

  const dishes: string[] = [];
  const suppliers: Array<string | null> = source.products.map((row) => row.supplier);
  for (const doc of source.documents) {
    if (doc.code === FINISHED_PRODUCT_CODE) {
      dishes.push(...strings(configField(doc.config, "itemsCatalog")), ...listItems(doc.config));
    } else if (doc.code === PERISHABLE_REJECTION_CODE) {
      for (const item of listItems(doc.config)) {
        const name = clean(item, CATALOG_NAME_MAX);
        if (name) addProduct({ name, shelfLifeHours: null, storage: null, supplier: null });
      }
      suppliers.push(...strings(configField(doc.config, "suppliers")));
    }
  }

  const content = {
    products: [...products.values()].sort((a, b) => collator.compare(a.name, b.name)).slice(0, CATALOG_LIMITS.products),
    dishes: uniqueSorted(dishes, CATALOG_LIMITS.dishes),
    suppliers: uniqueSorted(suppliers, CATALOG_LIMITS.suppliers),
    staff: uniqueSorted(
      source.staff.map((user) => user.name),
      CATALOG_LIMITS.staff,
    ),
  };
  return { version: catalogVersion(content), ...content };
}
