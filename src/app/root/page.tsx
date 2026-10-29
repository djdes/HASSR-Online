import { Building2 } from "lucide-react";
import { requireRoot } from "@/lib/auth-helpers";
import { getAllOrgMetrics } from "@/lib/org-metrics";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { MetricsTable } from "./metrics-table";
import { SeedDemoButton } from "./seed-demo-button";
import { getTranslations } from "next-intl/server";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { formatNumber } from "@/i18n/locales";
import { loadBaseMessages } from "@/i18n/messages";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export const dynamic = "force-dynamic";

const PLATFORM_ORG_ID = process.env.PLATFORM_ORG_ID || "platform";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Клиенты платформы (2026-10-29): короткая шапка, четыре цифры и список,
 * который помещается в экран. Длинные пояснения про цены и IP ушли —
 * IP теперь в карточке клиента.
 */
export default async function RootMetricsPage() {
  const session = await requireRoot();
  const [t, locale, sourceMessages, viewer] = await Promise.all([
    getTranslations("rootMetrics"),
    getSiteLocale(),
    loadBaseMessages("ru"),
    platformViewerForSession(session),
  ]);

  // Один момент времени на весь рендер: окна 7/14/30 дней и подписи
  // «N дн назад» считаются от него.
  const refDate = new Date();
  const metrics = await getAllOrgMetrics(PLATFORM_ORG_ID, refDate);
  const sorted = [...metrics].sort((a, b) => b.actualMrrRub - a.actualMrrRub);

  const now = refDate.getTime();
  const totalActualMrr = sorted.reduce((s, m) => s + m.actualMrrRub, 0);
  const totalPotentialMrr = sorted.reduce((s, m) => s + m.potentialMrrRub, 0);
  const activeOrgs = sorted.filter((m) => m.entries7d > 0).length;
  const payingOrgs = sorted.filter((m) => m.actualMrrRub > 0).length;
  const newOrgs = sorted.filter((m) => now - new Date(m.createdAt).getTime() <= 7 * DAY_MS).length;
  // Баллы на балансах — обязательство платформы: уменьшат будущие поступления.
  const totalBalance = sorted.reduce((s, m) => s + m.balanceRub, 0);

  return (
    <DomainMessagesBoundary namespaces={["rootMetrics", "settingsManagement", "journals"]}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
              <Building2 className="size-5" />
            </span>
            <div>
              <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("page.clientsTitle")}</h1>
              <p className="mt-1 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">{t("page.clientsSubtitle")}</p>
            </div>
          </div>
          {viewer.superadmin || viewer.sections.includes("sales") ? <SeedDemoButton /> : null}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={t("stats.clients")} value={formatNumber(locale, sorted.length)} hint={t("stats.newWeek", { count: newOrgs })} />
          <StatCard label={t("stats.active7d")} value={formatNumber(locale, activeOrgs)} hint={t("stats.ofTotal", { count: sorted.length })} />
          <StatCard
            label={t("stats.paying")}
            value={formatNumber(locale, payingOrgs)}
            hint={`${t("stats.payingHint", { amount: t("format.rubles", { amount: totalActualMrr }) })} · ${t("stats.potential", { amount: totalPotentialMrr })}`}
            accent
          />
          <StatCard label={t("stats.balance")} value={t("format.rubles", { amount: totalBalance })} hint={t("stats.liabilities")} />
        </div>

        <MetricsTable rows={sorted} now={now} sourceJournalNames={sourceMessages.journals.names} canManage={viewer.superadmin} />
      </div>
    </DomainMessagesBoundary>
  );
}

function StatCard({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] ${
        accent ? "border-[#5566f6]/30 bg-[#f5f6ff]" : "border-[#ececf4] bg-white"
      }`}
    >
      <div className="text-[12px] font-medium uppercase tracking-wider text-[#6f7282]">{label}</div>
      <div className="mt-1 text-[24px] font-semibold tabular-nums text-[#0b1024]">{value}</div>
      {hint ? <div className="text-[12px] text-[#9b9fb3]">{hint}</div> : null}
    </div>
  );
}
