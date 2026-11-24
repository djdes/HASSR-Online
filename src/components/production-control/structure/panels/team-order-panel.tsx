import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { FileText, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { isPointScoped } from "@/lib/point-scope";
import { PpkFolder } from "@/components/production-control/ppk-folder";
import { PPK_BUTTON_OUTLINE_CLASS, PPK_BUTTON_PRIMARY_CLASS } from "@/components/production-control/ppk-ui";
import type { PpkPanelProps } from "../item-panel";
import { PanelNote, PanelSection, SourceLink } from "./panel-ui";

/**
 * 2.4 «Приказ о группе ХАССП»: шаблон приказа из «Приказов» (состав подставляется
 * из группы ХАССП, текст правится там же) или скан своего приказа. Прежние сканы
 * подписанных документов группы — здесь же.
 */
export async function TeamOrderPanel({ item, scope, session }: PpkPanelProps) {
  const [orders, teamCount, t, locale] = await Promise.all([
    db.companyOrder.findMany({
      where: { organizationId: scope.organizationId, templateCode: "haccp-team" },
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, number: true, issuedAt: true },
      take: 5,
    }),
    db.ppkRecord.count({ where: { organizationId: scope.organizationId, buildingId: scope.buildingId, block: "team" } }),
    getTranslations("productionControl.structure.order"),
    getLocale(),
  ]);
  // Приказы компании руководителю точки закрыты (как в разделе «Приказы»).
  const ordersAllowed = !isPointScoped(session.user);
  const date = (value: Date) => value.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="space-y-8">
      <PanelSection
        title={t("ordersTitle")}
        hint={teamCount > 0 ? t("prefillHint") : undefined}
        actions={
          ordersAllowed ? (
            <Link href="/orders/haccp-team?prefill=ppk-team" className={orders.length ? PPK_BUTTON_OUTLINE_CLASS : PPK_BUTTON_PRIMARY_CLASS}>
              <Plus className="size-4" aria-hidden />
              {t("create")}
            </Link>
          ) : null
        }
      >
        {!ordersAllowed ? (
          <PanelNote>{t("pointNoOrders")}</PanelNote>
        ) : orders.length === 0 ? (
          <PanelNote>{teamCount > 0 ? t("noOrders") : t("noTeam")}</PanelNote>
        ) : (
          <ul className="space-y-2">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/orders/haccp-team?id=${order.id}`}
                  className="flex items-center gap-3 rounded-2xl bg-[var(--app-veil)] px-4 py-3 text-[14px] transition-colors duration-150 hover:bg-[var(--app-veil-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  <FileText className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
                  <span className="min-w-0 flex-1 font-medium text-[#0b1024]">
                    {t("orderLine", { number: order.number, date: date(order.issuedAt) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {teamCount === 0 ? <SourceLink href="/production-control/haccp/team">{t("toTeam")}</SourceLink> : null}
      </PanelSection>

      {item.scanFolder ? (
        <PanelSection title={t("scanTitle")} hint={t("scanHint")}>
          <PpkFolder folder={item.scanFolder} canManage />
        </PanelSection>
      ) : null}

      {item.legacyFolder ? (
        <PanelSection title={t("legacyTitle")} hint={t("legacyHint")}>
          <PpkFolder folder={item.legacyFolder} canManage />
        </PanelSection>
      ) : null}
    </div>
  );
}
