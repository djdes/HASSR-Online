"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, Loader2, RefreshCw, ScrollText, Search } from "lucide-react";

import { humanMsk } from "@/lib/mailing/forecast";
import { CHANNEL_LABELS, MAILING_CHANNELS } from "@/lib/mailing/labels";
import type { JournalData, JournalFilters } from "@/lib/mailing/operations.server";
import { cn } from "@/lib/utils";

import { CARD, ChannelStatusBadge, FilterSelect, INPUT, OUTLINE_SM, SECTION_LABEL, StatusPill } from "./ui";
import { api } from "./ui";

const STATUS_OPTIONS = [
  { value: "all", label: "Все статусы" },
  { value: "planned", label: "Запланировано и в очереди" },
  { value: "sent", label: "Отправлено" },
  { value: "failed", label: "Ошибка" },
  { value: "skipped", label: "Пропущено" },
  { value: "cancelled", label: "Отменено" },
  { value: "clicked", label: "Перешли по ссылке" },
  { value: "unsubscribed", label: "Отписались" },
];

export const EMPTY_JOURNAL_FILTERS: JournalFilters = {
  campaign: "",
  status: "",
  reason: "",
  search: "",
  from: "",
  to: "",
  page: 1,
};

function toQuery(f: JournalFilters): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (k === "page" ? v !== 1 : v) q.set(k, String(v));
  }
  return q;
}

/**
 * «Журнал отправки» — как в YesBeat: каждый получатель — кому (почта, имя,
 * компания), когда (ждущие — на времени попытки, остальные — на времени
 * отправки), что (рассылка), статус по каналам, причина ожидания, попытки и
 * переходы. Фильтры по рассылке, статусу, причине, поиску и датам; по 50
 * строк; полный журнал по тем же фильтрам — в CSV.
 */
export function JournalTab({
  active,
  initialCampaign,
  onFiltersChange,
}: {
  active: boolean;
  initialCampaign: string;
  onFiltersChange?: (filters: JournalFilters) => void;
}) {
  const [filters, setFilters] = useState<JournalFilters>({ ...EMPTY_JOURNAL_FILTERS, campaign: initialCampaign });
  const [search, setSearch] = useState("");
  const [data, setData] = useState<JournalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.search === search.trim() ? f : { ...f, search: search.trim(), page: 1 })), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<JournalData>(`/api/root/mailing/journal?${toQuery(filters)}`));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  useEffect(() => onFiltersChange?.(filters), [filters, onFiltersChange]);

  const set = (patch: Partial<JournalFilters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

  const campaignOptions = useMemo(
    () => [{ value: "all", label: "Все рассылки" }, ...(data?.campaigns ?? []).map((c) => ({ value: c.id, label: c.title }))],
    [data?.campaigns]
  );
  const reasonOptions = useMemo(
    () => [
      { value: "all", label: "Любая причина" },
      ...(data?.reasons ?? []).map((r) => ({ value: r.reason, label: `${r.label} · ${r.count}` })),
    ],
    [data?.reasons]
  );
  const usedChannels = MAILING_CHANNELS.filter((ch) => data?.rows.some((r) => r.channels[ch]));
  const exportHref = `/api/root/mailing/journal/export?${toQuery({ ...filters, page: 1 })}`;

  return (
    <div className="space-y-5" data-testid="mailing-journal-tab">
      <section className={CARD}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className={cn(SECTION_LABEL, "flex items-center gap-2")}>
            <ScrollText className="size-4 text-[#5566f6]" /> Журнал отправки{data ? ` · ${data.count}` : ""}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={OUTLINE_SM} onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4 text-[#5566f6]" />}
              Обновить
            </button>
            <a href={exportHref} className={OUTLINE_SM} data-testid="journal-export">
              <Download className="size-4 text-[#5566f6]" /> CSV
            </a>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <FilterSelect
            label="Рассылка"
            value={filters.campaign || "all"}
            onChange={(v) => set({ campaign: v === "all" ? "" : v })}
            options={
              filters.campaign && !campaignOptions.some((o) => o.value === filters.campaign)
                ? [...campaignOptions, { value: filters.campaign, label: "Выбранная рассылка" }]
                : campaignOptions
            }
            testId="journal-campaign"
          />
          <FilterSelect
            label="Статус"
            value={filters.status || "all"}
            onChange={(v) => set({ status: v === "all" ? "" : (v as JournalFilters["status"]) })}
            options={STATUS_OPTIONS}
            testId="journal-status"
          />
          <FilterSelect
            label="Причина ожидания"
            value={filters.reason || "all"}
            onChange={(v) => set({ reason: v === "all" ? "" : v })}
            options={
              filters.reason && !reasonOptions.some((o) => o.value === filters.reason)
                ? [...reasonOptions, { value: filters.reason, label: filters.reason }]
                : reasonOptions
            }
            testId="journal-reason"
          />
          <label className="relative block min-w-0">
            <span className="mb-1.5 block text-[12px] font-medium text-[#6f7282]">Поиск</span>
            <Search className="pointer-events-none absolute bottom-3.5 left-3.5 size-4 text-[#9b9fb3]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Почта, имя, компания"
              className={cn(INPUT, "pl-10")}
              data-testid="journal-search"
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[12px] font-medium text-[#6f7282]">С даты (МСК)</span>
            <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className={INPUT} data-testid="journal-from" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[12px] font-medium text-[#6f7282]">По дату (МСК)</span>
            <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className={INPUT} data-testid="journal-to" />
          </label>
        </div>
      </section>

      <section className={CARD}>
        {failed && !data ? (
          <p className="text-[13px] text-[#a13a32]">Не удалось загрузить журнал — нажмите «Обновить».</p>
        ) : !data ? (
          <div className="flex items-center gap-2 text-[13px] text-[#6f7282]">
            <Loader2 className="size-4 animate-spin" /> Загружаем…
          </div>
        ) : data.rows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center text-[13px] text-[#6f7282]">
            Под эти фильтры никто не попал.
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1080px] text-[14px]" data-testid="journal-rows">
                <thead className="text-left text-[12px] text-[#6f7282]">
                  <tr className="border-b border-[#ececf4]">
                    <th className="py-2.5 pr-3 font-medium">Кому</th>
                    <th className="py-2.5 pr-3 font-medium">Когда</th>
                    <th className="py-2.5 pr-3 font-medium">Рассылка</th>
                    {usedChannels.map((ch) => (
                      <th key={ch} className="py-2.5 pr-3 font-medium">
                        {CHANNEL_LABELS[ch]}
                      </th>
                    ))}
                    <th className="py-2.5 pr-3 font-medium">Итог</th>
                    <th className="py-2.5 font-medium">Переходы</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-b border-[#f2f3f8] align-top" data-testid="journal-row">
                      <td className="max-w-[240px] py-3 pr-3">
                        <div className="font-medium text-[#0b1024] [overflow-wrap:anywhere]">{r.name || r.email || "—"}</div>
                        <div className="text-[13px] text-[#6f7282] [overflow-wrap:anywhere]">
                          {r.email ?? "нет почты"}
                          {r.companyName ? ` · ${r.companyName}` : ""}
                        </div>
                        <div className="mt-0.5 text-[12px] text-[#9b9fb3]">{r.kind === "contact" ? "контакт" : "пользователь"}</div>
                      </td>
                      <td className="whitespace-nowrap py-3 pr-3 text-[13px] text-[#3c4053]">
                        {humanMsk(r.eventAt)}
                        {r.status === "queued" ? <div className="text-[12px] text-[#9b9fb3]">план</div> : null}
                      </td>
                      <td className="max-w-[200px] py-3 pr-3 text-[13px]">
                        <Link href={`/root/mailing/${r.campaignId}`} className="text-[#3848c7] hover:text-[#5566f6] [overflow-wrap:anywhere]">
                          {r.campaignTitle}
                        </Link>
                      </td>
                      {usedChannels.map((ch) => (
                        <td key={ch} className="max-w-[200px] py-3 pr-3">
                          {r.channels[ch] ? (
                            <ChannelStatusBadge status={r.channels[ch]!.status} error={r.channels[ch]!.error} dryRun={r.dryRun} />
                          ) : (
                            <span className="text-[12px] text-[#9b9fb3]">—</span>
                          )}
                        </td>
                      ))}
                      <td className="max-w-[220px] py-3 pr-3">
                        <StatusPill status={r.status} label={r.statusLabel} />
                        {r.waitLabel ? <div className="mt-1 text-[12px] leading-snug text-[#a16d32]">{r.waitLabel}</div> : null}
                        {r.attempts > 0 ? <div className="mt-1 text-[12px] text-[#9b9fb3]">попыток: {r.attempts}</div> : null}
                      </td>
                      <td className="py-3 text-[13px] text-[#3c4053]">
                        {r.clickCount || "—"}
                        {r.unsubscribed ? <div className="text-[12px] text-[#a13a32]">отписался</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="space-y-2 lg:hidden">
              {data.rows.map((r) => (
                <li key={r.id} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3" data-testid="journal-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-[#0b1024] [overflow-wrap:anywhere]">{r.name || r.email || "—"}</div>
                      <div className="text-[13px] text-[#6f7282] [overflow-wrap:anywhere]">{r.email ?? "нет почты"}</div>
                    </div>
                    <StatusPill status={r.status} label={r.statusLabel} />
                  </div>
                  <div className="mt-1.5 text-[12px] text-[#6f7282]">
                    {humanMsk(r.eventAt)}
                    {r.status === "queued" ? " (план)" : ""} · {r.campaignTitle}
                  </div>
                  {r.waitLabel ? <div className="mt-1 text-[12px] text-[#a16d32]">{r.waitLabel}</div> : null}
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {MAILING_CHANNELS.filter((ch) => r.channels[ch]).map((ch) => (
                      <div key={ch} className="rounded-xl border border-[#ececf4] bg-white p-2">
                        <div className="mb-1 text-[12px] font-medium text-[#6f7282]">{CHANNEL_LABELS[ch]}</div>
                        <ChannelStatusBadge status={r.channels[ch]!.status} error={r.channels[ch]!.error} dryRun={r.dryRun} />
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>

            {data.pages > 1 ? (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[13px] text-[#6f7282]" data-testid="journal-pages">
                <button type="button" className={OUTLINE_SM} disabled={data.page <= 1 || loading} onClick={() => set({ page: data.page - 1 })}>
                  Назад
                </button>
                <span className="tabular-nums">
                  Страница {data.page} из {data.pages}
                </span>
                <button
                  type="button"
                  className={OUTLINE_SM}
                  disabled={data.page >= data.pages || loading}
                  onClick={() => set({ page: data.page + 1 })}
                >
                  Дальше
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
