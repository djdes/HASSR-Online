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
import { isManagementRole } from "@/lib/user-roles";
import { ProductDialog } from "@/components/settings/product-dialog";
import { DeleteProductButton } from "@/components/settings/delete-product-button";
import { PageGuide } from "@/components/ui/page-guide";

export const dynamic = "force-dynamic";

const UNIT: Record<string, string> = {
  kg: "кг",
  l: "л",
  pcs: "шт",
  g: "г",
  ml: "мл",
  pack: "уп",
};

export default async function ProductsSettingsPage() {
  const session = await requireAuth();
  const orgId = getActiveOrgId(session);
  const canManage = isManagementRole(session.user.role);

  const products = await db.product.findMany({
    where: { organizationId: orgId, isActive: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-5">
      <PageGuide
        title="Когда нужен каталог продуктов"
        storageKey="settings-products-v1"
        bullets={[
          { title: "Для журналов брака и входного контроля", body: "Те журналы где надо указать конкретное наименование продукта (молоко, мясо, овощи) — берут варианты из этого каталога." },
          { title: "Опционально для большинства орг", body: "Если ведёте только уборку и температуру — каталог не нужен. Добавляйте по мере того как заведёте журналы которым он понадобится." },
          { title: "Загрузить из 1С/Excel", body: "Кнопка «Импорт» вверху — XLSX-файл с колонками «Название», «Ед. изм.», «Срок годности (дней)». Дубликаты не создаются." },
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
                Справочник продуктов
              </h1>
              <p className="mt-0.5 text-[14px] text-[#6f7282]">
                Импорт из Excel, iiko, 1С — или вручную
              </p>
            </div>
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <ProductDialog />
            <ProductImportDialog />
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
            Продуктов пока нет
          </h3>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-[#6f7282]">
            {canManage
              ? "Импортируйте справочник из Excel / iiko / 1С или добавьте продукты вручную."
              : "Администратор ещё не загрузил справочник продуктов."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <table className="w-full min-w-[780px] text-[15px]">
            <thead className="bg-[#f8f9fc] text-[13px] text-[#6f7282]">
              <tr>
                <th className="px-6 py-3 text-left font-medium">
                  Наименование
                </th>
                <th className="px-6 py-3 text-left font-medium">Поставщик</th>
                <th className="px-6 py-3 text-left font-medium">Штрих-код</th>
                <th className="px-6 py-3 text-center font-medium">Ед.</th>
                <th className="px-6 py-3 text-left font-medium">Хранение</th>
                <th className="px-6 py-3 text-center font-medium">
                  Срок (дн.)
                </th>
                {canManage && (
                  <th className="w-[100px] px-6 py-3 text-right font-medium">
                    Действия
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
                    {UNIT[product.unit] || product.unit}
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
          Поддерживаемые форматы импорта
        </div>
        <ul className="mt-3 grid gap-2 text-[13px] text-[#6f7282] sm:grid-cols-2">
          <li>
            <strong className="text-[#0b1024]">Excel</strong> (.xlsx, .xls) —
            Наименование, Поставщик, Штрих-код, Ед., Категория
          </li>
          <li>
            <strong className="text-[#0b1024]">iiko</strong> — экспорт
            номенклатуры (Товар, Контрагент, Ед.изм., Штрихкод)
          </li>
          <li>
            <strong className="text-[#0b1024]">1С</strong> — выгрузка
            справочника Номенклатура
          </li>
          <li>
            <strong className="text-[#0b1024]">CSV</strong> — разделитель ; или
            , (первая строка — заголовки)
          </li>
        </ul>
      </section>
    </div>
  );
}
