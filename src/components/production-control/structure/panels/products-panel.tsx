import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { parsePpkRecords } from "@/lib/ppk/records";
import { ppkWhere } from "@/lib/ppk/scope";
import { IMPORTED_PRODUCT_KINDS } from "@/lib/ppk/product-import";
import { PpkCreateButton } from "@/components/production-control/ppk-ui";
import { ProductsClient } from "@/app/(dashboard)/production-control/haccp/products/products-client";
import type { PpkPanelProps } from "../item-panel";
import { ProductsImportButton } from "./products-import-button";

/**
 * 1.5 «Перечень выпускаемой продукции»: тот же редактор описания продукции,
 * что в блоке, плюс «Загрузить из справочника» (готовая продукция и
 * полуфабрикаты справочника продукции).
 */
export async function ProductsPanel({ scope }: PpkPanelProps) {
  const [rows, directoryCount, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { ...ppkWhere(scope), block: "products" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    db.product.count({
      where: { organizationId: scope.organizationId, isActive: true, kind: { in: [...IMPORTED_PRODUCT_KINDS] } },
    }),
    getTranslations("productionControl.products"),
  ]);
  const initial = parsePpkRecords("products", rows).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));

  return (
    <ProductsClient
      initial={initial}
      header={
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <PpkCreateButton label={t("add")} />
          <ProductsImportButton available={directoryCount} />
        </div>
      }
    />
  );
}
