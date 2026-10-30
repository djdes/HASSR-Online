import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, Package, TrendingDown } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { SectionSettingsPage } from "@/components/settings/section-settings-page";
import { AlertPill } from "@/components/dashboard/alert-pill";
import { StaleCapaNag } from "@/components/dashboard/stale-capa-nag";
import { canManageMaxOrganization } from "@/lib/max/service";
import { MaxIcon } from "@/components/max/max-icon";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

/**
 * «Остальное» — всё, что не попало в восемь разделов меню (решение
 * владельца: «сюда пока скинуть всё остальное»). Сверху — тревоги по
 * нарушениям, партиям и потерям: раньше они жили на главной.
 */
export default async function MorePage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
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
  const canConfigureMax = await canManageMaxOrganization(session.user.id, organizationId);

  return (
    <SectionSettingsPage session={session} section="more">
      {canConfigureMax ? (
        <a href="/settings/integrations/max" className="group flex min-h-20 items-center gap-4 rounded-2xl border border-[#ececf4] bg-white px-5 py-4 transition-colors hover:border-[#d6d9ee] hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]"><MaxIcon className="size-6" /></span>
          <span className="min-w-0"><span className="block text-[15px] font-semibold text-[#0b1024]">MAX</span><span className="mt-1 block text-[13px] leading-relaxed text-[#6f7282]">Личный кабинет в мессенджере и групповой чат организации</span></span>
        </a>
      ) : null}
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
