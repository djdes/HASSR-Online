import Link from "next/link";
import { ArrowRightLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { FORMAT_LOCALES, formatNumber } from "@/i18n/locales";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { requireRoot } from "@/lib/auth-helpers";
import { displayRunStatus, isExchangeTrigger } from "@/lib/directory-exchange/runs";
import { loadExchangeRunsOverview, type CabinetLabel } from "@/lib/directory-exchange/runs.server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_TONE: Record<string, string> = {
  ok: "bg-[#ecfdf3] text-[#116b2a]",
  busy: "bg-[#fff8eb] text-[#b25f00]",
  error: "bg-[#fff4f2] text-[#a13a32]",
  running: "bg-[#f5f6ff] text-[#3848c7]",
  stale: "bg-[#f4f4f7] text-[#6f7282]",
};
const FILTER = "inline-flex h-9 items-center rounded-2xl border px-3 text-[13px] font-medium transition-colors duration-150";
const FILTER_ON = "border-[#0b1024] bg-[#0b1024] text-white";
const FILTER_OFF = "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]";

type PageProps = { searchParams: Promise<{ errors?: string | string[] }> };

/**
 * Обмен справочниками (серия D, Р2): каждая попытка обмена кабинетов
 * клиентов — повод, итог, длительность, счётчики и ошибка; кабинеты, где
 * последний обмен — ошибка или успешного обмена не было за сутки. Фильтр
 * «Только ошибки» — `?errors=1`. Доступ — как у раздела «Клиенты» с охватом
 * «все клиенты» (platform-access.ts).
 */
export default async function RootDirectoryExchangePage({ searchParams }: PageProps) {
  await requireRoot();
  const params = await searchParams;
  const onlyErrors = (Array.isArray(params.errors) ? params.errors[0] : params.errors) === "1";
  const now = new Date();
  const [t, locale, overview] = await Promise.all([
    getTranslations("rootDirectoryExchange"),
    getSiteLocale(),
    loadExchangeRunsOverview({ now, onlyErrors }),
  ]);

  const moment = (value: Date | null) =>
    value
      ? value.toLocaleString(FORMAT_LOCALES[locale], {
          timeZone: "Europe/Moscow",
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
  const duration = (ms: number | null) =>
    ms === null ? "—" : t("seconds", { value: formatNumber(locale, Math.round(ms / 100) / 10, { maximumFractionDigits: 1 }) });
  const triggerLabel = (value: string) => (isExchangeTrigger(value) ? t(`triggers.${value}`) : value);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <ArrowRightLeft className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("title")}</h1>
          <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">{t("description")}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-[#f5f6ff] px-3 py-1 text-[13px] text-[#3848c7]">
          {t("stats.cabinets", { count: formatNumber(locale, overview.cabinets) })}
        </span>
        <span
          className={cn(
            "rounded-full px-3 py-1 text-[13px]",
            overview.problems.length > 0 ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#ecfdf3] text-[#116b2a]",
          )}
        >
          {t("stats.problems", { count: formatNumber(locale, overview.problems.length) })}
        </span>
      </div>

      <section className="space-y-3" data-testid="exchange-problems">
        <div>
          <h2 className="text-[18px] font-semibold text-[#0b1024]">{t("problems.title")}</h2>
          <p className="mt-0.5 text-[13px] text-[#6f7282]">{t("problems.hint")}</p>
        </div>
        {overview.problems.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-8 text-center text-[14px] text-[#116b2a]">
            {t("problems.empty")}
          </div>
        ) : (
          <ul className="divide-y divide-[#ececf4] overflow-hidden rounded-3xl border border-[#ececf4] bg-white">
            {overview.problems.map((item) => (
              <li key={item.cabinet.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4">
                <div className="min-w-0 flex-1 basis-[260px]">
                  <CabinetCell cabinet={item.cabinet} unknownOwner={t("unknownOwner")} />
                  <div className="mt-1 text-[12.5px] text-[#6f7282]">{t("problems.members", { count: formatNumber(locale, item.members) })}</div>
                </div>
                <div className="min-w-0 flex-1 basis-[260px] text-[13px] text-[#3c4053]">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium",
                      item.problem === "error" ? STATUS_TONE.error : STATUS_TONE.busy,
                    )}
                  >
                    {item.problem === "error" ? t("problems.error") : t("problems.noSuccess")}
                  </span>
                  <div className="mt-1 text-[12.5px] text-[#6f7282]">
                    {item.lastOkAt ? t("problems.lastOk", { date: moment(item.lastOkAt) }) : t("problems.neverOk")}
                    {item.lastRun ? ` · ${t("problems.lastRun", { date: moment(item.lastRun.startedAt) })}` : ""}
                  </div>
                  {item.problem === "error" && item.lastRun?.error ? (
                    <div className="mt-1 break-words text-[12.5px] text-[#a13a32]">{item.lastRun.error}</div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-[18px] font-semibold text-[#0b1024]">{t("runs.title")}</h2>
          <div className="flex gap-2" role="group" aria-label={t("runs.filter")}>
            <Link href="/root/directory-exchange" className={cn(FILTER, onlyErrors ? FILTER_OFF : FILTER_ON)} aria-current={onlyErrors ? undefined : "page"}>
              {t("runs.all")}
            </Link>
            <Link
              href="/root/directory-exchange?errors=1"
              className={cn(FILTER, onlyErrors ? FILTER_ON : FILTER_OFF)}
              aria-current={onlyErrors ? "page" : undefined}
              data-testid="exchange-runs-errors"
            >
              {t("runs.onlyErrors")}
            </Link>
          </div>
        </div>
        {overview.runs.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-8 text-center text-[14px] text-[#6f7282]">
            {onlyErrors ? t("runs.emptyErrors") : t("runs.empty")}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
            <table className="w-full min-w-[960px] text-[13.5px]" data-testid="exchange-runs-table">
              <thead>
                <tr className="bg-[#fafbff] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                  <th className="px-4 py-3">{t("columns.when")}</th>
                  <th className="px-4 py-3">{t("columns.cabinet")}</th>
                  <th className="px-4 py-3">{t("columns.trigger")}</th>
                  <th className="px-4 py-3">{t("columns.status")}</th>
                  <th className="px-4 py-3">{t("columns.duration")}</th>
                  <th className="px-4 py-3">{t("columns.result")}</th>
                  <th className="px-4 py-3">{t("columns.error")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.runs.map((run) => {
                  const status = displayRunStatus(run, now);
                  return (
                    <tr key={run.id} className="border-t border-[#ececf4] align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-[#3c4053]">{moment(run.startedAt)}</td>
                      <td className="px-4 py-3">
                        <CabinetCell cabinet={run.cabinet} unknownOwner={t("unknownOwner")} />
                      </td>
                      <td className="px-4 py-3 text-[#3c4053]">{triggerLabel(run.trigger)}</td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium", STATUS_TONE[status] ?? STATUS_TONE.stale)}>
                          {t(`statuses.${status}`)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#3c4053]">{duration(run.durationMs)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#3c4053]">
                        {run.status === "ok"
                          ? t("result", {
                              created: formatNumber(locale, run.created),
                              updated: formatNumber(locale, run.updated),
                              skipped: formatNumber(locale, run.skipped),
                            })
                          : "—"}
                      </td>
                      <td className="max-w-[320px] break-words px-4 py-3 text-[12.5px] text-[#a13a32]">{run.error ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Кабинет и владелец его аккаунта: имя и почта для связи. */
function CabinetCell({ cabinet, unknownOwner }: { cabinet: CabinetLabel; unknownOwner: string }) {
  const owner = [cabinet.ownerName, cabinet.ownerEmail].filter(Boolean).join(" · ");
  return (
    <>
      <div className="break-words font-medium text-[#0b1024]">{cabinet.name}</div>
      <div className="break-words text-[12px] text-[#9b9fb3]">{owner || unknownOwner}</div>
    </>
  );
}
