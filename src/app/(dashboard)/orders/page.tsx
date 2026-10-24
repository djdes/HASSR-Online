import Link from "next/link";
import { FileText, Plus, ScrollText } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { requireAuth } from "@/lib/auth-helpers";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { PageHeader } from "@/components/ui/page-header";
import { groupedOrderTemplates } from "@/lib/orders/catalog";
import { listOrders } from "@/lib/orders/store";
import { OrdersRegistry } from "./orders-registry";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("ordersUi");
  return { title: t("page.title") };
}

/**
 * Раздел «Приказы» — третий тип документов рядом с журналами и
 * инструкциями.
 *
 * Экран делится надвое: сверху то, что уже издано (это спрашивают на
 * проверке), снизу шаблоны, которые можно издать. Порядок именно такой:
 * человек чаще приходит сюда распечатать существующий приказ, чем
 * завести новый.
 */
export default async function OrdersPage() {
  const t = await getTranslations("ordersUi");
  const session = await requireAuth();
  const organizationId = getActiveOrgId(session);
  const canManage = hasFullWorkspaceAccess(session.user);

  const [orders, groups] = await Promise.all([
    listOrders(organizationId),
    Promise.resolve(groupedOrderTemplates()),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
      />

      <OrdersRegistry
        orders={orders.map((order) => ({
          id: order.id,
          templateCode: order.templateCode,
          title: order.title,
          number: order.number,
          issuedAt: order.issuedAt.toISOString(),
        }))}
        canManage={canManage}
      />

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <ScrollText className="size-5 text-[#5566f6]" />
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {t("page.templates")}
          </h2>
        </div>

        {groups.map((group) => (
          <div key={group.category} className="space-y-3">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {group.label}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.items.map((template) => (
                <Link
                  key={template.code}
                  href={`/orders/${template.code}`}
                  className="group flex flex-col gap-2 rounded-2xl border border-[#ececf4] bg-white p-4 transition-all duration-150 hover:border-[#5566f6]/40 hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)]"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff]">
                      <FileText className="size-4 text-[#5566f6]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium leading-snug text-[#0b1024]">
                        {template.title}
                      </div>
                      <p className="mt-1 text-[12.5px] leading-[1.5] text-[#6f7282]">
                        {template.purpose}
                      </p>
                    </div>
                  </div>
                  <div className="mt-auto flex items-center gap-1.5 pt-1 text-[13px] font-medium text-[#3848c7] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <Plus className="size-3.5" />
                    {t("page.fillAndPrint")}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
