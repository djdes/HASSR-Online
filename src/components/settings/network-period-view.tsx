import { MoreText } from "@/components/ui/more-text";
import { getLocale, getTranslations } from "next-intl/server";

import { NetworkGoButton } from "@/components/settings/network-go-button";
import { formatNumber, type Locale } from "@/i18n/locales";
import { periodPercent, type NetworkPeriodRow, type PeriodStatus } from "@/lib/network-period";
import type { NetworkPeriodSummary } from "@/lib/network-period.server";
import { canOpenNetworkOrg } from "@/lib/network-mini.server";
import { formatNetworkDay } from "@/lib/network-summary";
import { cn } from "@/lib/utils";

const PILL = "inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-medium whitespace-nowrap";
const PILL_TONE = {
  ok: "bg-[#ecfdf5] text-[#116b2a]",
  warn: "bg-[#fff8eb] text-[#b25f00]",
  danger: "bg-[#fff4f2] text-[#a13a32]",
  muted: "bg-[#f5f6ff] text-[#6f7282]",
  info: "bg-[#eef1ff] text-[#3848c7]",
} as const;

const STATUS_TONE: Record<PeriodStatus, keyof typeof PILL_TONE> = {
  done: "ok",
  partial: "warn",
  none: "danger",
  empty: "muted",
  unknown: "muted",
};

/** День периода («2026-11-14», Москва) — полдень, чтобы формат по Москве не съехал на сутки. */
const dayOf = (dayKey: string) => new Date(`${dayKey}T12:00:00.000Z`);

/**
 * «Сеть» за 7 или 30 дней (серия E, Р6): итоги и таблица — дни с
 * заполненными обязательными журналами (из дней периода, когда организация
 * работала) и записи журналов. Широкий экран — таблица, телефон — карточки.
 */
export async function NetworkPeriodView({
  summary,
  openableIds,
}: {
  summary: NetworkPeriodSummary;
  /** Куда человек может переключиться (`openableNetworkOrgIds`): у управляющего сетью — не во все организации. */
  openableIds: readonly string[];
}) {
  const [t, locale] = await Promise.all([getTranslations("settingsManagement.network"), getLocale() as Promise<Locale>]);
  const openable = new Set(openableIds);
  const { rows, totals } = summary;
  const totalPercent = periodPercent(totals);

  const filledText = (row: NetworkPeriodRow) =>
    row.stats ? t("period.value", { filled: String(row.stats.filledDays), days: String(row.stats.days) }) : t("journals.unknown");
  const statusPill = (row: NetworkPeriodRow) => {
    const percent = periodPercent(row.stats);
    return (
      <span className={cn(PILL, PILL_TONE[STATUS_TONE[row.status]])}>
        {t(`period.status.${row.status}`)}
        {percent !== null && row.status !== "empty" ? ` · ${t("period.percent", { percent: String(percent) })}` : ""}
      </span>
    );
  };
  const recordsText = (row: NetworkPeriodRow) => (row.stats ? formatNumber(locale, row.stats.records) : t("journals.unknown"));
  const nameCell = (row: NetworkPeriodRow) => (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="min-w-0 break-words text-[14px] font-medium text-[#0b1024]">{row.name}</span>
      {row.current ? <span className={cn(PILL, PILL_TONE.info)}>{t("current")}</span> : null}
      {row.deletionRequested ? <span className={cn(PILL, PILL_TONE.danger)}>{t("deleting")}</span> : null}
    </span>
  );
  const goButton = (row: NetworkPeriodRow) =>
    canOpenNetworkOrg(row, openable) ? (
      <NetworkGoButton organizationId={row.id} current={row.current} label={t("go")} failedLabel={t("goFailed")} />
    ) : null;

  return (
    <div className="space-y-5" data-network-period-view={summary.days}>
      <p className="text-[13px] leading-relaxed text-[#6f7282]">
        {t("period.range", { from: formatNetworkDay(dayOf(summary.range.from), locale), to: formatNetworkDay(dayOf(summary.range.to), locale) })}
        {" "}
        <MoreText text={t("period.hint")} />
      </p>

      <section className="grid gap-3 sm:grid-cols-3" data-network-period-totals>
        <div className="rounded-3xl border border-[#ececf4] bg-white p-5">
          <div className="text-[13px] text-[#6f7282]">{t("totals.organizations")}</div>
          <div className="mt-1 text-[24px] font-semibold tabular-nums text-[#0b1024]">{totals.organizations}</div>
        </div>
        <div className="rounded-3xl border border-[#ececf4] bg-white p-5">
          <div className="text-[13px] text-[#6f7282]">{t("period.totals.filled")}</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="text-[24px] font-semibold tabular-nums text-[#0b1024]" data-network-period-filled>
              {t("period.value", { filled: String(totals.filledDays), days: String(totals.days) })}
            </span>
            {totalPercent !== null ? (
              <span className={cn(PILL, PILL_TONE[totalPercent >= 100 ? "ok" : totalPercent > 0 ? "warn" : "danger"])}>
                {t("period.percent", { percent: String(totalPercent) })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="rounded-3xl border border-[#ececf4] bg-white p-5">
          <div className="text-[13px] text-[#6f7282]">{t("period.totals.records")}</div>
          <div className="mt-1 text-[24px] font-semibold tabular-nums text-[#0b1024]" data-network-period-records>
            {formatNumber(locale, totals.records)}
          </div>
        </div>
      </section>

      <section className="hidden overflow-x-auto rounded-3xl border border-[#ececf4] bg-white md:block">
        <table className="w-full border-separate border-spacing-0 text-[13.5px]">
          <thead>
            <tr>
              <th scope="col" className="border-b border-[#ececf4] px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]">
                {t("columns.organization")}
              </th>
              <th scope="col" className="border-b border-[#ececf4] px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]">
                {t("period.columns.filled")}
              </th>
              <th scope="col" className="border-b border-[#ececf4] px-4 py-3 text-right text-[12px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]">
                {t("period.columns.records")}
              </th>
              <th scope="col" className="border-b border-[#ececf4] px-4 py-3">
                <span className="sr-only">{t("columns.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-network-period-org={row.id}>
                <td className="border-b border-[#f2f3f8] px-4 py-3 align-middle">{nameCell(row)}</td>
                <td className="border-b border-[#f2f3f8] px-4 py-3 align-middle">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold tabular-nums text-[#0b1024]">{filledText(row)}</span>
                    {statusPill(row)}
                  </span>
                </td>
                <td className="border-b border-[#f2f3f8] px-4 py-3 text-right align-middle font-semibold tabular-nums text-[#0b1024] whitespace-nowrap">
                  {recordsText(row)}
                </td>
                <td className="border-b border-[#f2f3f8] px-4 py-3 text-right align-middle">{goButton(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="rounded-3xl border border-[#ececf4] bg-white p-4" data-network-period-card={row.id}>
            {nameCell(row)}
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13.5px]">
              <dt className="text-[#6f7282]">{t("period.columns.filled")}</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="font-semibold tabular-nums text-[#0b1024]">{filledText(row)}</span>
                {statusPill(row)}
              </dd>
              <dt className="text-[#6f7282]">{t("period.columns.records")}</dt>
              <dd className="font-semibold tabular-nums text-[#0b1024]">{recordsText(row)}</dd>
            </dl>
            {canOpenNetworkOrg(row, openable) ? <div className="mt-3 flex justify-end">{goButton(row)}</div> : null}
          </li>
        ))}
      </ul>

      {summary.truncated ? <p className="text-[13px] text-[#6f7282]">{t("truncated", { count: String(rows.length) })}</p> : null}
    </div>
  );
}
