"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink, RefreshCw, Clock3, TriangleAlert } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { directPreset, validateDirectRange, type DirectMetrics, type DirectReady, type DirectRange, type DirectErrorCode } from "@/lib/yandex-direct-report";
import type { Messages } from "@/i18n/messages";

type Stage = "loading" | "processing" | "waiting" | "ready" | "error";
type ChartMetric = "clicks" | "impressions" | "conversions" | "cost";
const ERROR_CODES: readonly DirectErrorCode[] = ["invalid_range", "not_configured", "provider_auth", "provider_unavailable", "rate_limited"];
const TABLE_METRICS: Array<keyof DirectMetrics> = ["impressions", "clicks", "cost", "ctr", "cpc", "conversions", "conversionRate", "cpa"];
const TOTAL_METRICS: Array<keyof DirectMetrics> = ["impressions", "clicks", "cost", "conversions", "ctr", "cpa"];
const PRESETS = [
  { key: "today", days: 1, offset: 0 }, { key: "yesterday", days: 1, offset: 1 },
  { key: "sevenDays", days: 7, offset: 0 }, { key: "thirtyDays", days: 30, offset: 0 },
  { key: "ninetyDays", days: 90, offset: 0 },
] as const;
const BUTTON = "inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3.5 py-2 text-[14px] font-medium text-[#3c4053] transition-colors hover:border-[#5566f6]/50 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/20 disabled:cursor-wait disabled:opacity-60";
const INPUT = "min-h-10 min-w-0 rounded-2xl border border-[#dcdfed] bg-white px-3 py-2 text-[14px] text-[#0b1024] outline-none transition-colors focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15";

export function DirectStatsClient({ today }: { today: string }) {
  const t = useTranslations("rootDirect"), locale = useLocale();
  const [range, setRange] = useState<DirectRange>(() => directPreset(30, today));
  const [draft, setDraft] = useState(range);
  const [preset, setPreset] = useState<string | null>("thirtyDays");
  const [data, setData] = useState<DirectReady | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<DirectErrorCode | null>(null);
  const [invalidRange, setInvalidRange] = useState(false);
  const [version, setVersion] = useState(0);
  const [metric, setMetric] = useState<ChartMetric>("clicks");
  const forceRefresh = useRef(false);
  const visibleData = data?.range.from === range.from && data?.range.to === range.to ? data : null;
  const busy = stage === "loading" || stage === "processing";
  const formatters = useMemo(() => ({
    number: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    money: new Intl.NumberFormat(locale, { style: "currency", currency: "RUB", maximumFractionDigits: 2 }),
    compact: new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
    day: new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: "short" }),
    date: new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }),
    time: new Intl.DateTimeFormat(locale, { timeZone: "Europe/Moscow", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
  }), [locale]);

  function dateLabel(value: string, full = false): string {
    const stamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(stamp) ? (full ? formatters.date : formatters.day).format(stamp) : value;
  }
  function valueLabel(key: keyof DirectMetrics, value: number | null): string {
    if (value === null || !Number.isFinite(value)) return t("notAvailable");
    if (key === "cost" || key === "cpc" || key === "cpa") return formatters.money.format(value);
    if (key === "ctr" || key === "conversionRate") return `${formatters.number.format(value)}%`;
    return formatters.number.format(value);
  }
  function refresh() { forceRefresh.current = true; setVersion(current => current + 1); }

  useEffect(() => {
    const controller = new AbortController();
    let active = true, timer: ReturnType<typeof setTimeout> | undefined, attempts = 0;
    const started = Date.now(), force = forceRefresh.current;
    forceRefresh.current = false;
    setStage("loading"); setError(null);
    setData(current => current?.range.from === range.from && current?.range.to === range.to ? current : null);
    async function load(force: boolean) {
      try {
        const query = new URLSearchParams({ from: range.from, to: range.to });
        if (force) query.set("refresh", "1");
        const response = await fetch(`/api/root/yandex-direct?${query}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (!active) return;
        if (!response.ok) {
          const code = ERROR_CODES.includes(payload?.error) ? payload.error as DirectErrorCode : "provider_unavailable";
          setError(code); setStage("error"); return;
        }
        if (!payload?.range || payload.range.from !== range.from || payload.range.to !== range.to) throw new Error("Unexpected report window");
        if (payload.status === "processing") {
          attempts++;
          if (attempts >= 30 || Date.now() - started >= 180_000) { setStage("waiting"); return; }
          setStage("processing");
          const seconds = Number(payload.retryAfter);
          timer = setTimeout(() => void load(false), (Number.isFinite(seconds) ? Math.max(2, Math.min(60, seconds)) : 5) * 1000);
          return;
        }
        if (payload.status !== "ready" || !payload.totals || !Array.isArray(payload.campaigns) || !Array.isArray(payload.daily) || !Number.isFinite(Date.parse(payload.updatedAt))) throw new Error("Unexpected report payload");
        setData(payload as DirectReady); setError(null); setStage("ready");
      } catch {
        if (active && !controller.signal.aborted) { setError("provider_unavailable"); setStage("error"); }
      }
    }
    void load(force);
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [range.from, range.to, version]);

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const next = validateDirectRange(draft.from, draft.to, today);
      setInvalidRange(false); setPreset(null); setRange(next);
    } catch { setInvalidRange(true); }
  }
  function selectPreset(item: typeof PRESETS[number]) {
    const next = directPreset(item.days, today, item.offset);
    setPreset(item.key); setDraft(next); setRange(next); setInvalidRange(false);
  }
  function stateLabel(value: string): string {
    const states: Record<string, keyof Messages["rootDirect"]["states"]> = { ON: "ON", OFF: "OFF", SUSPENDED: "SUSPENDED", ARCHIVED: "ARCHIVED", ENDED: "ENDED", CONVERTED: "CONVERTED" };
    return t(`states.${states[value] ?? "UNKNOWN"}`);
  }
  function statusLabel(value: string): string {
    const statuses: Record<string, keyof Messages["rootDirect"]["statuses"]> = { ACCEPTED: "ACCEPTED", DRAFT: "DRAFT", MODERATION: "MODERATION", REJECTED: "REJECTED" };
    return t(`statuses.${statuses[value] ?? "UNKNOWN"}`);
  }
  const emptyActivity = visibleData && visibleData.totals.impressions === 0 && visibleData.totals.clicks === 0 && visibleData.totals.cost === 0 && visibleData.totals.conversions === 0;

  return (
    <div className="space-y-5" data-direct-stage={stage}>
      <PageHeader title={t("title")} description={t("description")} actions={
        <>
          <a href="https://direct.yandex.ru/" target="_blank" rel="noopener noreferrer" className={BUTTON}>
            {t("openDirect")}<ExternalLink className="size-4" aria-hidden />
          </a>
          <button type="button" onClick={refresh} disabled={busy} className={cn(BUTTON, "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]")}>
            <RefreshCw className={cn("size-4", busy && "animate-spin motion-reduce:animate-none")} aria-hidden />{busy ? t("refreshing") : t("refresh")}
          </button>
        </>
      } />

      <section aria-label={t("period")} className="space-y-4 rounded-2xl border border-[#ececf4] bg-white p-4 sm:p-5">
        <div role="group" aria-label={t("period")} className="flex flex-wrap gap-2">
          {PRESETS.map(item => <button key={item.key} type="button" aria-pressed={preset === item.key} onClick={() => selectPreset(item)}
            className={cn(BUTTON, "min-h-9 px-3 py-1.5", preset === item.key && "border-[#5566f6]/40 bg-[#eef1ff] text-[#3848c7]")}>{t(item.key)}</button>)}
        </div>
        <form onSubmit={applyRange} className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-[190px]">
            <label htmlFor="direct-date-from" className="text-[13px] font-medium text-[#3c4053]">{t("from")}</label>
            <input id="direct-date-from" type="date" required max={draft.to || today} value={draft.from} onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} aria-invalid={invalidRange || undefined} aria-describedby={invalidRange ? "direct-range-error" : undefined} className={INPUT} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-[190px]">
            <label htmlFor="direct-date-to" className="text-[13px] font-medium text-[#3c4053]">{t("to")}</label>
            <input id="direct-date-to" type="date" required min={draft.from} max={today} value={draft.to} onChange={event => setDraft(current => ({ ...current, to: event.target.value }))} aria-invalid={invalidRange || undefined} aria-describedby={invalidRange ? "direct-range-error" : undefined} className={INPUT} />
          </div>
          <button type="submit" className={cn(BUTTON, "col-span-2 sm:col-span-1")}>{t("apply")}</button>
        </form>
        {invalidRange && <p id="direct-range-error" role="alert" className="text-[13px] text-[#a13a32]">{t("errors.invalid_range")}</p>}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[#6f7282]">
        <p>{t("rangeLabel", { from: dateLabel(range.from, true), to: dateLabel(range.to, true) })}</p>
        {visibleData && <p>{t("updated", { time: formatters.time.format(new Date(visibleData.updatedAt)) })}</p>}
      </div>

      {(stage === "processing" || stage === "waiting") && <div role="status" className="flex items-start gap-3 rounded-2xl border border-[#dcdfed] bg-[#f5f6ff] p-4 text-[#3c4053]">
        <Clock3 className="mt-0.5 size-5 shrink-0 text-[#5566f6]" aria-hidden />
        <div className="min-w-0 flex-1"><p className="text-[14px] font-medium text-[#0b1024]">{stage === "waiting" ? t("waiting") : t("processing")}</p>
          <p className="mt-1 text-[13px] leading-relaxed">{stage === "waiting" ? t("waitingHint") : t("processingHint")}</p>
          {visibleData && <p className="mt-1 text-[13px]">{t("stale")}</p>}
          {stage === "waiting" && <button type="button" className={cn(BUTTON, "mt-3")} onClick={refresh}>{t("refresh")}</button>}
        </div>
      </div>}

      {stage === "error" && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-[#f0cfc7] bg-[#fff4f2] p-4 text-[#a13a32]">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1"><p className="text-[14px] font-medium">{t("errorTitle")}</p><p className="mt-1 text-[13px] leading-relaxed">{t(`errors.${error ?? "provider_unavailable"}`)}</p>
          {visibleData && <p className="mt-1 text-[13px]">{t("stale")}</p>}
          <button type="button" className={cn(BUTTON, "mt-3")} onClick={refresh}>{t("retry")}</button>
        </div>
      </div>}

      {!visibleData && stage === "loading" && <div role="status" aria-label={t("loading")} className="space-y-5">
        <div className="grid grid-cols-2 gap-5 rounded-2xl border border-[#ececf4] bg-white p-5 sm:grid-cols-3 xl:grid-cols-6">
          {TOTAL_METRICS.map(key => <div key={key} className="space-y-3"><div className="h-3 w-24 animate-pulse rounded bg-[#ececf4] motion-reduce:animate-none" /><div className="h-6 w-20 animate-pulse rounded bg-[#ececf4] motion-reduce:animate-none" /></div>)}
        </div>
        <div className="h-64 animate-pulse rounded-2xl border border-[#ececf4] bg-white motion-reduce:animate-none" />
      </div>}

      {visibleData && <div aria-busy={busy} className="space-y-5">
        <section aria-label={t("totals")} className="rounded-2xl border border-[#ececf4] bg-white p-5">
          <dl className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 xl:grid-cols-6">
            {TOTAL_METRICS.map(key => <div key={key} className="min-w-0"><dt className="text-[13px] leading-relaxed text-[#6f7282]">{t(`metrics.${key}`)}</dt>
              <dd data-metric={key} className="mt-1.5 break-words text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024] tabular-nums" aria-label={visibleData.totals[key] === null ? t("unavailableValue") : undefined}>{valueLabel(key, visibleData.totals[key])}</dd></div>)}
          </dl>
        </section>

        <section className="rounded-2xl border border-[#ececf4] bg-white p-4 sm:p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("dynamicTitle")}</h2>
            <label className="flex items-center gap-2 text-[13px] text-[#6f7282]">
              <span className="sr-only">{t("chartMetric")}</span>
              <select aria-label={t("chartMetric")} value={metric} onChange={event => setMetric(event.target.value as ChartMetric)} className={cn(INPUT, "min-h-9 py-1.5")}>
                {(["clicks", "conversions", "impressions", "cost"] as const).map(key => <option key={key} value={key}>{t(`metrics.${key}`)}</option>)}
              </select>
            </label>
          </div>
          {emptyActivity ? <div className="flex min-h-56 flex-col items-center justify-center px-3 text-center"><p className="text-[15px] font-medium text-[#0b1024]">{t("noActivity")}</p><p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-[#6f7282]">{t("noActivityHint")}</p></div> :
            <div className="h-64 min-w-0" role="region" aria-label={t("chartLabel", { metric: t(`metrics.${metric}`), from: dateLabel(range.from, true), to: dateLabel(range.to, true) })}>
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 256 }}>
                <LineChart data={visibleData.daily} margin={{ top: 10, right: 12, bottom: 5, left: 0 }} accessibilityLayer>
                  <CartesianGrid vertical={false} stroke="var(--app-border)" />
                  <XAxis dataKey="date" tickFormatter={value => dateLabel(String(value))} minTickGap={35} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--app-text-muted)" }} />
                  <YAxis allowDecimals={metric === "cost" || metric === "conversions"} width={48} tickFormatter={value => formatters.compact.format(Number(value))} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--app-text-muted)" }} />
                  <Tooltip labelFormatter={value => dateLabel(String(value), true)} formatter={value => [valueLabel(metric, typeof value === "number" ? value : null), t(`metrics.${metric}`)]} contentStyle={{ borderRadius: 12, backgroundColor: "var(--app-surface)", color: "var(--app-text)", borderColor: "var(--app-border-strong)", fontSize: 13 }} />
                  <Line dataKey={metric} type="monotone" stroke="var(--app-indigo)" strokeWidth={2} dot={visibleData.daily.length <= 7 ? { r: 3 } : false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>}
        </section>

        <section aria-labelledby="direct-campaign-heading" className="overflow-hidden rounded-2xl border border-[#ececf4] bg-white">
          <h2 id="direct-campaign-heading" className="px-5 py-4 text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("campaignTitle")}</h2>
          {visibleData.campaigns.length === 0 ? <div className="border-t border-[#ececf4] px-5 py-8"><p className="text-[15px] font-medium text-[#0b1024]">{t("noCampaigns")}</p><p className="mt-2 text-[14px] text-[#6f7282]">{t("noCampaignsHint")}</p></div> :
            <div role="region" tabIndex={0} aria-label={t("tableScroll")} className="max-w-full overflow-x-auto focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#5566f6]/20">
              <table className="w-full min-w-[1100px] border-collapse text-[13px] tabular-nums">
                <thead className="border-y border-[#ececf4] bg-[#fafbff] text-[#6f7282]"><tr>
                  <th scope="col" className="w-[290px] px-5 py-3 text-left font-medium">{t("campaignName")}</th>
                  {TABLE_METRICS.map(key => <th key={key} scope="col" className="px-3 py-3 text-right font-medium">{t(`metrics.${key}`)}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-[#ececf4] text-[#3c4053]">
                  {visibleData.campaigns.map(campaign => <tr key={campaign.id} data-campaign-id={campaign.id}>
                    <th scope="row" className="px-5 py-4 text-left align-top font-normal">
                      <span className="block text-[14px] font-medium leading-relaxed text-[#0b1024]">{campaign.name}</span>
                      <span className="mt-1 block text-[12px] text-[#6f7282]">{t(`placement.${campaign.placement}`)} · № {campaign.id}</span>
                      <span className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[12px]"><span className={campaign.state === "ON" ? "text-[#116b2a]" : "text-[#6f7282]"}>{stateLabel(campaign.state)}</span><span className="text-[#6f7282]">{statusLabel(campaign.status)}</span></span>
                    </th>
                    {TABLE_METRICS.map(key => <td key={key} className="whitespace-nowrap px-3 py-4 text-right align-top" aria-label={campaign.metrics[key] === null ? t("unavailableValue") : undefined}>{valueLabel(key, campaign.metrics[key])}</td>)}
                  </tr>)}
                </tbody>
              </table>
            </div>}
        </section>
        <div className="space-y-1.5 text-[12px] leading-relaxed text-[#6f7282]"><p>{t("timezone")}</p><p className="max-w-[100ch]">{t("attribution")}</p></div>
      </div>}
    </div>
  );
}