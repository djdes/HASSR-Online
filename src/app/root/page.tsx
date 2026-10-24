import { ChartLine, Coins } from "lucide-react";
import { requireRoot } from "@/lib/auth-helpers";
import { getAllOrgMetrics } from "@/lib/org-metrics";
import { MetricsTable } from "./metrics-table";
import { SeedDemoButton } from "./seed-demo-button";
import { EXTRA_USER_PRICE_RUB, SUBSCRIPTION_MAX_USERS } from "@/lib/plan-catalog";
import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { getTranslations } from "next-intl/server";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { formatNumber } from "@/i18n/locales";
import { loadBaseMessages } from "@/i18n/messages";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export const dynamic = "force-dynamic";

const PLATFORM_ORG_ID = process.env.PLATFORM_ORG_ID || "platform";

export default async function RootMetricsPage() {
  await requireRoot();
  const [t, locale, sourceMessages] = await Promise.all([getTranslations("rootMetrics"), getSiteLocale(), loadBaseMessages("ru")]);

  // Один момент времени на весь рендер: и окна 7/14/30 дней в метриках,
  // и относительные подписи «N дн назад» в таблице считаются от него.
  const refDate = new Date();
  const metrics = await getAllOrgMetrics(PLATFORM_ORG_ID, refDate);

  // Порядок по умолчанию — тот же, что стартовый в <MetricsTable>
  // (MRR по убыванию), чтобы первый кадр не прыгал после гидратации.
  const sorted = [...metrics].sort((a, b) => b.actualMrrRub - a.actualMrrRub);

  const totalActualMrr = sorted.reduce((s, m) => s + m.actualMrrRub, 0);
  const totalPotentialMrr = sorted.reduce(
    (s, m) => s + m.potentialMrrRub,
    0
  );
  const totalActiveUsers = sorted.reduce((s, m) => s + m.activeUsers, 0);
  const totalEntries7d = sorted.reduce((s, m) => s + m.entries7d, 0);
  const activeOrgs = sorted.filter((m) => m.entries7d > 0).length;
  // Баллы на всех балансах — обязательство платформы: эти рубли уже
  // «обещаны» клиентам и уменьшат будущие поступления.
  const totalBalance = sorted.reduce((s, m) => s + m.balanceRub, 0);

  return (
    <DomainMessagesBoundary namespaces={["rootMetrics", "settingsManagement", "journals"]}>
    <div className="space-y-6">
      <div>
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <ChartLine className="size-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[clamp(1.625rem,1.5vw+1.2rem,2rem)] font-semibold tracking-[-0.02em] text-[#0b1024]">
                {t("page.title")}
              </h1>
              <SeedDemoButton />
            </div>
            <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
              {t("page.summary")} {t("page.pricing", { freeSeats: FREE_MAX_USERS, subscriptionSeats: SUBSCRIPTION_MAX_USERS, extraSeatPrice: EXTRA_USER_PRICE_RUB })} {t("page.tableHelp")} {t("page.ipHistory", { since: "26.08.2026" })}
            </p>
          </div>
        </div>
      </div>

      {/* Aggregate stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard label={t("stats.organizations")} value={formatNumber(locale, sorted.length)} />
        <StatCard
          label={t("stats.active7d")}
          value={formatNumber(locale, activeOrgs)}
          hint={t("stats.ofTotal", { count: sorted.length })}
        />
        <StatCard label={t("stats.employees")} value={formatNumber(locale, totalActiveUsers)} />
        <StatCard label={t("stats.entries7d")} value={formatNumber(locale, totalEntries7d)} />
        <StatCard
          label={t("stats.balance")}
          value={t("format.rubles", { amount: totalBalance })}
          hint={t("stats.liabilities")}
        />
        <StatCard
          label={t("stats.mrr")}
          value={t("format.rubles", { amount: totalActualMrr })}
          hint={t("stats.potential", { amount: totalPotentialMrr })}
          accent
        />
      </div>

      <MetricsTable rows={sorted} now={refDate.getTime()} sourceJournalNames={sourceMessages.journals.names} />
    </div>
    </DomainMessagesBoundary>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        accent
          ? "border-[#5566f6]/30 bg-[#f5f6ff]"
          : "border-[#ececf4] bg-white"
      } shadow-[0_0_0_1px_rgba(240,240,250,0.45)]`}
    >
      <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-[#6f7282]">
        {accent ? <Coins className="size-3.5" /> : null}
        {label}
      </div>
      <div className="mt-1 text-[24px] font-semibold tabular-nums text-[#0b1024]">
        {value}
      </div>
      {hint ? (
        <div className="text-[12px] text-[#9b9fb3]">{hint}</div>
      ) : null}
    </div>
  );
}
