import Link from "next/link";
import { forbidden } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageHeaderStat } from "@/components/ui/page-header";
import { NetworkGoButton } from "@/components/settings/network-go-button";
import { NetworkPeriodBar } from "@/components/settings/network-period-bar";
import { NetworkPeriodView } from "@/components/settings/network-period-view";
import { NetworkManagersSection } from "@/components/settings/network-managers-section";
import type { Locale } from "@/i18n/locales";
import { ADD_POINTS_HREF } from "@/lib/add-points";
import { getActiveOrgId, isImpersonating, requireAuth } from "@/lib/auth-helpers";
import {
  formatNetworkDateTime,
  formatNetworkDay,
  formatNetworkRub,
  type JournalDayStatus,
  type NetworkOrgRow,
  type NetworkPlan,
} from "@/lib/network-summary";
import { canOpenNetworkOrg, openableNetworkOrgIds } from "@/lib/network-mini.server";
import { NetworkSummaryAccessError, loadNetworkSummary } from "@/lib/network-summary.server";
import { networkPeriodDays, parseNetworkPeriod } from "@/lib/network-period";
import { loadNetworkPeriod } from "@/lib/network-period.server";
import { isPointScoped } from "@/lib/point-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PILL = "inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-medium whitespace-nowrap";
const PILL_TONE = {
  ok: "bg-[#ecfdf5] text-[#116b2a]",
  warn: "bg-[#fff8eb] text-[#b25f00]",
  danger: "bg-[#fff4f2] text-[#a13a32]",
  muted: "bg-[#f5f6ff] text-[#6f7282]",
  info: "bg-[#eef1ff] text-[#3848c7]",
} as const;

const JOURNAL_TONE: Record<JournalDayStatus, keyof typeof PILL_TONE> = {
  done: "ok",
  partial: "warn",
  none: "danger",
  empty: "muted",
  unknown: "muted",
};

/**
 * «Сеть» (серия D, Р4): сводка по организациям аккаунта для его владельца —
 * журналы за сегодня, баланс, свои 14 дней, последний обмен справочниками и
 * «Перейти». Только полный доступ, не «войти как», не руководитель точки,
 * владелец аккаунта активной организации с двумя организациями и больше
 * (`loadNetworkSummary`); остальным — 403, пункта меню у них нет.
 */
export default async function NetworkSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [name: string]: string | string[] | undefined }>;
}) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user) || isImpersonating(session) || isPointScoped(session.user)) forbidden();
  // «Сегодня / 7 дней / 30 дней» (серия E, Р6): за период журналы за сегодня не считаем.
  const period = parseNetworkPeriod((await searchParams).period);
  const days = networkPeriodDays(period);
  const summary = await loadNetworkSummary({ ownerUserId: session.user.id, activeOrgId: getActiveOrgId(session), journals: days === null }).catch(
    (error: unknown) => {
      if (error instanceof NetworkSummaryAccessError) return null;
      throw error;
    },
  );
  if (!summary) forbidden();
  const periodSummary =
    days === null ? null : await loadNetworkPeriod(summary.accountId, days, { activeOrgId: summary.activeOrganizationId });

  const [t, tTariffs, locale, openable] = await Promise.all([
    getTranslations("settingsManagement.network"),
    getTranslations("landingComponents.tariffs"),
    getLocale() as Promise<Locale>,
    openableNetworkOrgIds(session.user.id),
  ]);

  const planText = (plan: NetworkPlan): string => {
    switch (plan.kind) {
      case "paid":
        return t("plan.paid", { tier: tTariffs(`tiers.${plan.tier}.name`), count: plan.points });
      case "legacy":
        return t("plan.legacy");
      case "trial":
        return plan.lastDay ? t("plan.trial", { date: formatNetworkDay(plan.lastDay, locale) }) : t("plan.trialNoDate");
      case "free":
        return t("plan.free");
      case "none":
        return t("plan.none");
    }
  };

  const { rows, totals } = summary;
  const journalsText = (row: NetworkOrgRow) =>
    row.journals ? t("journals.value", { done: String(row.journals.done), total: String(row.journals.total) }) : t("journals.unknown");
  const journalPill = (row: NetworkOrgRow) => (
    <span className={cn(PILL, PILL_TONE[JOURNAL_TONE[row.journalStatus]])}>{t(`journals.status.${row.journalStatus}`)}</span>
  );
  const trialCell = (row: NetworkOrgRow) => {
    if (row.trial.state === "trial") {
      return <span className={cn(PILL, PILL_TONE.info)}>{t("trial.active", { date: formatNetworkDay(row.trial.lastDay, locale) })}</span>;
    }
    if (row.trial.state === "locked") {
      return (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className={cn(PILL, PILL_TONE.danger)}>{t("trial.locked")}</span>
          <Link href={ADD_POINTS_HREF} className="text-[13px] font-medium text-[#3848c7] underline decoration-[#3848c7]/40 underline-offset-2 hover:decoration-[#3848c7]">
            {t("addPoint")}
          </Link>
        </span>
      );
    }
    return <span className="text-[13px] text-[#9b9fb3]">{t("trial.none")}</span>;
  };
  const exchangeText = (row: NetworkOrgRow) =>
    row.lastExchangeAt ? formatNetworkDateTime(row.lastExchangeAt, locale) : t("exchange.never");
  const nameCell = (row: NetworkOrgRow) => (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="min-w-0 break-words text-[14px] font-medium text-[#0b1024]">{row.name}</span>
      {row.current ? <span className={cn(PILL, PILL_TONE.info)}>{t("current")}</span> : null}
      {row.deletionRequested ? <span className={cn(PILL, PILL_TONE.danger)}>{t("deleting")}</span> : null}
    </span>
  );
  // «Перейти» — только туда, куда человек может переключиться (управляющий сетью — не везде участник).
  const goButton = (row: NetworkOrgRow) =>
    canOpenNetworkOrg(row, openable) ? (
      <NetworkGoButton organizationId={row.id} current={row.current} label={t("go")} failedLabel={t("goFailed")} />
    ) : null;

  return (
    <div className="space-y-5" data-network-summary>
      <SectionPageHeader
        description={t("description")}
        actions={<PageHeaderStat>{t("plan.label", { plan: planText(summary.plan) })}</PageHeaderStat>}
      />

      {/* Период и выгрузка (серия E, Р6): за 7/30 дней — своя таблица, иначе — «Сегодня» как было. */}
      <NetworkPeriodBar period={period} />
      {periodSummary ? <NetworkPeriodView summary={periodSummary} openableIds={[...openable]} /> : (<>

      <section className="grid gap-3 sm:grid-cols-3" data-network-totals>
        <div className="rounded-3xl border border-[#ececf4] bg-white p-5">
          <div className="text-[13px] text-[#6f7282]">{t("totals.organizations")}</div>
          <div className="mt-1 text-[24px] font-semibold tabular-nums text-[#0b1024]">{totals.organizations}</div>
        </div>
        <div className="rounded-3xl border border-[#ececf4] bg-white p-5">
          <div className="text-[13px] text-[#6f7282]">{t("totals.balance")}</div>
          <div className="mt-1 text-[24px] font-semibold tabular-nums text-[#0b1024]" data-network-total-balance>
            {formatNetworkRub(totals.balanceRub, locale)}
          </div>
        </div>
        <div className="rounded-3xl border border-[#ececf4] bg-white p-5">
          <div className="text-[13px] text-[#6f7282]">{t("totals.unfilled")}</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="text-[24px] font-semibold tabular-nums text-[#0b1024]" data-network-unfilled>
              {t("totals.unfilledValue", { count: String(totals.withUnfilled), total: String(totals.organizations) })}
            </span>
            {totals.withUnfilled === 0 ? <span className={cn(PILL, PILL_TONE.ok)}>{t("totals.allFilled")}</span> : null}
          </div>
        </div>
      </section>

      {/* Широкий экран — таблица, телефон — карточки. */}
      <section className="hidden overflow-x-auto rounded-3xl border border-[#ececf4] bg-white md:block">
        <table className="w-full border-separate border-spacing-0 text-[13.5px]">
          <thead>
            <tr>
              {(["organization", "journals", "balance", "trial", "exchange"] as const).map((column) => (
                <th
                  key={column}
                  scope="col"
                  className={cn(
                    "border-b border-[#ececf4] px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]",
                    column === "balance" && "text-right",
                  )}
                >
                  {t(`columns.${column}`)}
                </th>
              ))}
              <th scope="col" className="border-b border-[#ececf4] px-4 py-3">
                <span className="sr-only">{t("columns.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-network-org={row.id}>
                <td className="border-b border-[#f2f3f8] px-4 py-3 align-middle">{nameCell(row)}</td>
                <td className="border-b border-[#f2f3f8] px-4 py-3 align-middle">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold tabular-nums text-[#0b1024]">{journalsText(row)}</span>
                    {journalPill(row)}
                  </span>
                </td>
                <td className="border-b border-[#f2f3f8] px-4 py-3 text-right align-middle font-semibold tabular-nums text-[#0b1024] whitespace-nowrap">
                  {formatNetworkRub(row.balanceRub, locale)}
                </td>
                <td className="border-b border-[#f2f3f8] px-4 py-3 align-middle">{trialCell(row)}</td>
                <td className="border-b border-[#f2f3f8] px-4 py-3 align-middle text-[#3c4053] whitespace-nowrap">{exchangeText(row)}</td>
                <td className="border-b border-[#f2f3f8] px-4 py-3 text-right align-middle">{goButton(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="rounded-3xl border border-[#ececf4] bg-white p-4" data-network-card={row.id}>
            {nameCell(row)}
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13.5px]">
              <dt className="text-[#6f7282]">{t("columns.journals")}</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="font-semibold tabular-nums text-[#0b1024]">{journalsText(row)}</span>
                {journalPill(row)}
              </dd>
              <dt className="text-[#6f7282]">{t("columns.balance")}</dt>
              <dd className="font-semibold tabular-nums text-[#0b1024]">{formatNetworkRub(row.balanceRub, locale)}</dd>
              <dt className="text-[#6f7282]">{t("columns.trial")}</dt>
              <dd>{trialCell(row)}</dd>
              <dt className="text-[#6f7282]">{t("columns.exchange")}</dt>
              <dd className="text-[#3c4053]">{exchangeText(row)}</dd>
            </dl>
            {canOpenNetworkOrg(row, openable) ? <div className="mt-3 flex justify-end">{goButton(row)}</div> : null}
          </li>
        ))}
      </ul>

      {summary.truncated ? (
        <p className="text-[13px] text-[#6f7282]">{t("truncated", { count: String(rows.length) })}</p>
      ) : null}
      </>)}

      {/* Управляющие сетью (серия E, Р5) — только владельцу аккаунта. */}
      <NetworkManagersSection accountId={summary.accountId} viewerId={session.user.id} />
    </div>
  );
}
