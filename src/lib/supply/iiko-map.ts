/**
 * iiko → WeSetup: приходные накладные — во «Входящие накладные» (дальше та
 * же приёмка, что у УПД), акты списания — в «Потери», номенклатура
 * (товары и заготовки) — в справочник продуктов. Чистые функции.
 */
import type { IikoInvoice, IikoProduct, IikoSupplier, IikoWriteoff } from "./iiko";
import type { ParsedUpd, SupplyItem } from "./upd";

export type IikoDirectory = {
  products: Map<string, IikoProduct>;
  units: Map<string, string>;
  suppliers: Map<string, IikoSupplier>;
};

export function buildIikoDirectory(products: IikoProduct[], units: Map<string, string>, suppliers: IikoSupplier[]): IikoDirectory {
  return {
    products: new Map(products.map((product) => [product.id, product])),
    units,
    suppliers: new Map(suppliers.map((supplier) => [supplier.id, supplier])),
  };
}

/** Статусы, которые в WeSetup не нужны: удалённый документ — не поставка. */
const SKIP_STATUSES = new Set(["DELETED"]);

function unitOf(dir: IikoDirectory, unitId: string | null, productId: string | null): string | null {
  const id = unitId ?? (productId ? dir.products.get(productId)?.unitId ?? null : null);
  return id ? dir.units.get(id) ?? null : null;
}

/** Накладная iiko в том же виде, что разобранный УПД; null — удалена или пустая. */
export function iikoInvoiceToDocument(invoice: IikoInvoice, dir: IikoDirectory): ParsedUpd | null {
  if (invoice.status && SKIP_STATUSES.has(invoice.status.toUpperCase())) return null;
  const items: SupplyItem[] = invoice.items.flatMap((item) => {
    const product = item.productId ? dir.products.get(item.productId) : undefined;
    const name = product?.name ?? (item.article ? `Товар ${item.article}` : null);
    if (!name) return [];
    return [
      {
        line: item.num,
        name,
        unit: unitOf(dir, item.unitId, item.productId),
        quantity: item.amount,
        price: item.price,
        amount: item.sum,
        code: item.article,
        expiryDate: null,
      },
    ];
  });
  if (items.length === 0) return null;
  const supplier = invoice.supplierId ? dir.suppliers.get(invoice.supplierId) : undefined;
  const sums = items.map((item) => item.amount).filter((value): value is number => value !== null);
  return {
    kind: "invoice",
    function: "",
    formatVersion: null,
    number: invoice.number,
    date: invoice.date,
    seller: { name: supplier?.name ?? "Поставщик из iiko", inn: supplier?.inn ?? null, kpp: null },
    buyer: null,
    items,
    total: sums.length === items.length ? Math.round(sums.reduce((a, b) => a + b, 0) * 100) / 100 : null,
    basis: null,
    shippedDate: invoice.date,
  };
}

export type IikoLoss = {
  /** Ключ без дублей: `iiko:<id акта>:<строка>`. */
  sourceEntryId: string;
  /** YYYY-MM-DD */
  date: string;
  productName: string;
  quantity: number;
  unit: string;
  costRub: number | null;
  cause: string;
};

export function iikoWriteoffToLosses(writeoff: IikoWriteoff, dir: IikoDirectory): IikoLoss[] {
  if (writeoff.status && SKIP_STATUSES.has(writeoff.status.toUpperCase())) return [];
  const cause = writeoff.comment ?? (writeoff.number ? `Акт списания iiko № ${writeoff.number}` : "Акт списания iiko");
  return writeoff.items.flatMap((item, index) => {
    const product = item.productId ? dir.products.get(item.productId) : undefined;
    if (!product) return [];
    return [
      {
        sourceEntryId: `iiko:${writeoff.id}:${index + 1}`,
        date: writeoff.date,
        productName: product.name,
        quantity: item.amount ?? 0,
        unit: unitOf(dir, item.unitId, item.productId) ?? "шт",
        costRub: item.cost,
        cause,
      },
    ];
  });
}

/** Товары и заготовки — в справочник продуктов; блюда, услуги и модификаторы — нет. */
const DIRECTORY_TYPES = new Set(["GOODS", "PREPARED"]);

export function iikoProductsForDirectory(dir: IikoDirectory): Array<{ name: string; unit: string | null }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; unit: string | null }> = [];
  for (const product of dir.products.values()) {
    if (product.deleted || !product.type || !DIRECTORY_TYPES.has(product.type.toUpperCase())) continue;
    const key = product.name.toLocaleLowerCase("ru");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: product.name, unit: product.unitId ? dir.units.get(product.unitId) ?? null : null });
  }
  return out;
}
