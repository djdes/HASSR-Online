import {
  Barcode,
  Clock,
  FileSpreadsheet,
  Package,
  Snowflake,
} from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { ProductImportDialog } from "@/components/settings/product-import-dialog";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { isManagementRole } from "@/lib/user-roles";
import { ProductDialog } from "@/components/settings/product-dialog";
import { DeleteProductButton } from "@/components/settings/delete-product-button";
import { PageGuide } from "@/components/ui/page-guide";
import { getTranslations } from "next-intl/server";
import { productPageUnit } from "@/lib/settings-products-presentation";

export const dynamic = "force-dynamic";

export default async function ProductsSettingsPage() {
  const session = await requireAuth();
  const orgId = getActiveOrgId(session);
  const canManage = isManagementRole(session.user.role);

  const products = await db.product.findMany({
    where: { organizationId: orgId, isActive: true },
    orderBy: { name: "asc" },
  });

  const t = await getTranslations("settingsProducts");

  return (
    <DomainMessagesBoundary namespaces={["settingsProducts"]}>
    <div className="space-y-5">
      <PageGuide
        title={t("guide.title")}
        storageKey="settings-products-v1"
        bullets={[
          { title: t("guide.step1.title"), body: t("guide.step1.body") },
          { title: t("guide.step2.title"), body: t("guide.step2.body") },
          { title: t("guide.step3.title", { oneC: "1С", excel: "Excel" }), body: t("guide.step3.body", { format: "XLSX", nameHeader: "Название", unitHeader: "Ед. изм.", shelfHeader: "Срок годности" }) },
        ]}
      />
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>

          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#fff8eb] text-[#f59e0b]">
              <Package className="size-5" />
            </div>
            <div>
              <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
                {t("page.title")}
              </h1>
              <p className="mt-0.5 text-[14px] text-[#6f7282]">
                {t("page.description", { excel: "Excel", iiko: "iiko", oneC: "1С" })}
              </p>
            </div>
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <ProductDialog />
            <DomainMessagesBoundary namespaces={["settingsProductImport"]}><ProductImportDialog /></DomainMessagesBoundary>
          </div>
        )}
      </div>

      {/* Content */}
      {products.length === 0 ? (
        <div className="rounded-2xl border border-[#ececf4] bg-white px-8 py-16 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#fff8eb]">
            <Package className="size-7 text-[#f59e0b]" />
          </div>
          <h3 className="mt-5 text-[17px] font-semibold text-[#0b1024]">
            {t("empty.title")}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-[#6f7282]">
            {canManage
              ? t("empty.management", { excel: "Excel", iiko: "iiko", oneC: "1С" })
              : t("empty.employee")}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <table className="w-full min-w-[780px] text-[15px]">
            <thead className="bg-[#f8f9fc] text-[13px] text-[#6f7282]">
              <tr>
                <th className="px-6 py-3 text-left font-medium">
                  {t("table.name")}
                </th>
                <th className="px-6 py-3 text-left font-medium">{t("table.supplier")}</th>
                <th className="px-6 py-3 text-left font-medium">{t("table.barcode")}</th>
                <th className="px-6 py-3 text-center font-medium">{t("table.unit")}</th>
                <th className="px-6 py-3 text-left font-medium">{t("table.storage")}</th>
                <th className="px-6 py-3 text-center font-medium">
                  {t("table.shelfLife")}
                </th>
                {canManage && (
                  <th className="w-[100px] px-6 py-3 text-right font-medium">
                    {t("table.actions")}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr
                  key={product.id}
                  className="border-t border-[#f0f1f8] transition-colors hover:bg-[#fafbff]"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-[#fffbf0] text-[#f59e0b]">
                        <Package className="size-4" />
                      </div>
                      <div>
                        <div className="font-medium text-[#0b1024]">
                          {product.name}
                        </div>
                        {product.category && (
                          <div className="text-[12px] text-[#9b9fb3]">
                            {product.category}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-[14px] text-[#6f7282]">
                    {product.supplier || "—"}
                  </td>
                  <td className="px-6 py-4">
                    {product.barcode ? (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-[#f3f4f6] px-2 py-0.5 font-mono text-[12px] text-[#6f7282]">
                        <Barcode className="size-3" />
                        {product.barcode}
                      </span>
                    ) : (
                      <span className="text-[13px] text-[#c7ccea]">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center text-[14px] text-[#6f7282]">
                    {productPageUnit(product.unit, t)}
                  </td>
                  <td className="px-6 py-4">
                    {product.storageTemp ? (
                      <span className="inline-flex items-center gap-1 text-[13px] text-[#6f7282]">
                        <Snowflake className="size-3 text-[#0ea5e9]" />
                        {product.storageTemp}
                      </span>
                    ) : (
                      <span className="text-[13px] text-[#c7ccea]">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {product.shelfLifeDays != null ? (
                      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-[#0b1024]">
                        <Clock className="size-3 text-[#6f7282]" />
                        {product.shelfLifeDays}
                      </span>
                    ) : (
                      <span className="text-[13px] text-[#c7ccea]">—</span>
                    )}
                  </td>
                  {canManage && (
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-1">
                        <ProductDialog
                          product={{
                            id: product.id,
                            name: product.name,
                            supplier: product.supplier,
                            barcode: product.barcode,
                            unit: product.unit,
                            category: product.category,
                            storageTemp: product.storageTemp,
                            shelfLifeDays: product.shelfLifeDays,
                          }}
                        />
                        {session.user.role === "owner" && (
                          <DeleteProductButton
                            productId={product.id}
                            productName={product.name}
                          />
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Import formats */}
      <section className="rounded-2xl border border-[#f0f1f8] bg-[#fafbff] p-6">
        <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
          <FileSpreadsheet className="size-4 text-[#10b981]" />
          {t("formats.title")}
        </div>
        <ul className="mt-3 grid gap-2 text-[13px] text-[#6f7282] sm:grid-cols-2">
          <li>
{t.rich("formats.excel", { brandValue: (chunks) => <strong className="text-[#0b1024]">{chunks}</strong>, brand: "Excel", extensions: "(.xlsx, .xls)", headers: "Наименование, Поставщик, Штрих-код, Ед., Категория" })}
          </li>
          <li>
            {t.rich("formats.iiko", { brandValue: (chunks) => <strong className="text-[#0b1024]">{chunks}</strong>, brand: "iiko", headers: "Товар, Контрагент, Ед.изм., Штрихкод" })}
          </li>
          <li>
            {t.rich("formats.oneC", { brandValue: (chunks) => <strong className="text-[#0b1024]">{chunks}</strong>, brand: "1С", directory: "Номенклатура" })}
          </li>
          <li>
            {t.rich("formats.csv", { brandValue: (chunks) => <strong className="text-[#0b1024]">{chunks}</strong>, brand: "CSV", semicolon: ";", comma: "," })}
          </li>
        </ul>
      </section>
    </div>
    </DomainMessagesBoundary>
  );
}
