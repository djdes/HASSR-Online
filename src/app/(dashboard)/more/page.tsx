import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, Package, TrendingDown } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { SectionSettingsPage } from "@/components/settings/section-settings-page";
import { AlertPill } from "@/components/dashboard/alert-pill";
import { StaleCapaNag } from "@/components/dashboard/stale-capa-nag";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

/**
 * «Остальное» — всё, что не попало в восемь разделов меню (решение
 * владельца: «сюда пока скинуть всё остальное»). Сверху — тревоги по
 * нарушениям, партиям и потерям: раньше они жили на главной.
 */
export default async function MorePage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const t = await getTranslations("moreUi");
  const organizationId = getActiveOrgId(session);
  const now = Date.now();

  const [openCapaCount, staleCapaCount, expiringBatches, weekLossCount] = await Promise.all([
    db.capaTicket.count({ where: { organizationId, status: { not: "closed" } } }),
    // Открыты дольше недели — менеджер, скорее всего, забыл их закрыть.
    db.capaTicket.count({
      where: { organizationId, status: { not: "closed" }, createdAt: { lt: new Date(now - 7 * DAY) } },
    }),
    db.batch.count({
      where: {
        organizationId,
        expiryDate: { lte: new Date(now + 3 * DAY) },
        status: { notIn: ["expired", "written_off", "shipped"] },
      },
    }),
    db.lossRecord.count({ where: { organizationId, date: { gte: new Date(now - 7 * DAY) } } }),
  ]);
  const hasAlerts = openCapaCount > 0 || expiringBatches > 0 || weekLossCount > 0;

  return (
    <SectionSettingsPage session={session} section="more">
      <StaleCapaNag count={staleCapaCount} />
      {hasAlerts ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-more-alerts>
          {openCapaCount > 0 ? (
            <AlertPill href="/capa" tone="red" icon={AlertTriangle} value={openCapaCount} label={t("page.openCapa")} />
          ) : null}
          {expiringBatches > 0 ? (
            <AlertPill href="/batches?status=received" tone="amber" icon={Package} value={expiringBatches} label={t("page.expiringBatches")} />
          ) : null}
          {weekLossCount > 0 ? (
            <AlertPill href="/losses" tone="orange" icon={TrendingDown} value={weekLossCount} label={t("page.weekLosses")} />
          ) : null}
        </section>
      ) : null}
    </SectionSettingsPage>
  );
}
