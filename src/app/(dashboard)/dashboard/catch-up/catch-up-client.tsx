"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  Loader2,
  Sparkles,
  Wand2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";

type DayStatus =
  | "filled"
  | "missing"
  | "out_of_period"
  | "future"
  | "no_document";

type JournalRow = {
  templateCode: string;
  templateName: string;
  documentId: string | null;
  documentTitle: string | null;
  expectedRoster: number;
  days: { date: string; status: DayStatus; filledCount: number }[];
};

type GridResponse = {
  windowDays: number;
  days: string[];
  rows: JournalRow[];
};

type FillResult = {
  totalCopied: number;
  results: {
    documentId: string;
    date: string;
    copied: number;
    sourceDate?: string;
    skippedReason?:
      | "no_source"
      | "out_of_period"
      | "doc_not_found"
      | "already_filled";
  }[];
};

type Translate = ReturnType<typeof useTranslations<"dashboardUi.catchUpClient">>;

function formatDayHeader(dateKey: string, t: Translate) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const days = [
    t("daySun"),
    t("dayMon"),
    t("dayTue"),
    t("dayWed"),
    t("dayThu"),
    t("dayFri"),
    t("daySat"),
  ];
  const months = [
    t("monthJan"),
    t("monthFeb"),
    t("monthMar"),
    t("monthApr"),
    t("monthMay"),
    t("monthJun"),
    t("monthJul"),
    t("monthAug"),
    t("monthSep"),
    t("monthOct"),
    t("monthNov"),
    t("monthDec"),
  ];
  const weekday = days[d.getUTCDay()];
  const label = `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
  return { weekday, label, full: `${weekday} ${label}` };
}

export function CatchUpClient() {
  const t = useTranslations("dashboardUi.catchUpClient");
  const router = useRouter();
  const [data, setData] = useState<GridResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, Set<string>>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [pending, startTransition] = useTransition();

  async function loadGrid() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/catch-up", { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || t("loadError"));
      }
      const j = (await res.json()) as GridResponse;
      setData(j);
      setSelected(new Map());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadGrid();
  }, []);

  function toggleCell(documentId: string, date: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(documentId) ?? new Set<string>());
      if (set.has(date)) set.delete(date);
      else set.add(date);
      if (set.size === 0) next.delete(documentId);
      else next.set(documentId, set);
      return next;
    });
  }

  function selectAllMissing() {
    if (!data) return;
    const next = new Map<string, Set<string>>();
    for (const row of data.rows) {
      if (!row.documentId) continue;
      const set = new Set<string>();
      for (const d of row.days) {
        if (d.status === "missing") set.add(d.date);
      }
      if (set.size > 0) next.set(row.documentId, set);
    }
    setSelected(next);
  }

  function clearSelection() {
    setSelected(new Map());
  }

  const totalSelected = useMemo(() => {
    let n = 0;
    for (const s of selected.values()) n += s.size;
    return n;
  }, [selected]);

  const totalMissing = useMemo(() => {
    if (!data) return 0;
    let n = 0;
    for (const row of data.rows) {
      for (const d of row.days) if (d.status === "missing") n += 1;
    }
    return n;
  }, [data]);

  async function fillSelected() {
    if (totalSelected === 0) return;
    setSubmitting(true);
    try {
      const targets: { documentId: string; date: string }[] = [];
      for (const [documentId, dates] of selected) {
        for (const date of dates) targets.push({ documentId, date });
      }
      const res = await fetch("/api/dashboard/catch-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      const j = (await res.json().catch(() => null)) as FillResult | null;
      if (!res.ok) throw new Error((j as { error?: string } | null)?.error || t("error"));
      const totalCopied = j?.totalCopied ?? 0;
      const noSource = j?.results.filter((r) => r.skippedReason === "no_source").length ?? 0;
      if (totalCopied > 0) {
        toast.success(t("filledToast", { count: totalCopied }));
      } else if (noSource > 0) {
        toast.info(t("noSourceToast"));
      } else {
        toast.info(t("alreadyFilledToast"));
      }
      await loadGrid();
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Пилюлю «Пропусков всего» не переносим: то же число стоит прямо
          под шапкой на кнопке «Выбрать все пропуски (N)». */}
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={selectAllMissing}
            disabled={loading || totalMissing === 0}
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50"
          >
            <Sparkles className="size-4 text-[#5566f6]" />
            {t("selectAllMissing", { count: totalMissing })}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={loading || totalSelected === 0}
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13px] font-medium text-[#3c4053] transition-colors hover:border-[#dcdfed] hover:bg-[#fafbff] disabled:opacity-50"
          >
            {t("reset")}
          </button>
        </div>
        <button
          type="button"
          onClick={fillSelected}
          disabled={submitting || pending || totalSelected === 0}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60 sm:w-auto"
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Wand2 className="size-4" />
          )}
          {t("fillSelected", { count: totalSelected })}
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]">
          {error}
        </div>
      ) : null}

      {loading ? (
        // P2.H.4 — Skeleton вместо спиннера: пользователь видит контур
        // будущей таблицы (8 строк × 7 колонок), что ощущается заметно
        // быстрее чем спиннер на пустом фоне.
        <div className="overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="border-b border-[#ececf4] px-4 py-3">
            <Skeleton className="h-3 w-32 rounded-full" />
          </div>
          <div className="divide-y divide-[#ececf4]">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-3 w-32 rounded-full" />
                <div className="flex-1" />
                {Array.from({ length: 7 }).map((__, j) => (
                  <Skeleton key={j} className="h-7 w-7 rounded-lg" />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : data ? (
        <div className="overflow-x-auto rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-b border-[#ececf4] bg-white px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                  {t("journalColumn")}
                </th>
                {data.days.map((d) => {
                  const h = formatDayHeader(d, t);
                  return (
                    <th
                      key={d}
                      className="border-b border-[#ececf4] px-1.5 py-2 text-center text-[11px] font-medium text-[#6f7282]"
                      title={h.full}
                    >
                      <div className="text-[10px] uppercase text-[#9b9fb3]">
                        {h.weekday}
                      </div>
                      <div>{h.label}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.templateCode}>
                  <td className="sticky left-0 z-10 border-b border-[#ececf4] bg-white px-4 py-3 align-top">
                    <Link
                      href={
                        row.documentId
                          ? `/journals/${row.templateCode}/documents/${row.documentId}`
                          : `/journals/${row.templateCode}`
                      }
                      className="block min-w-0"
                    >
                      <div className="text-[13px] font-medium text-[#0b1024] truncate">
                        {row.templateName}
                      </div>
                      {row.documentTitle ? (
                        <div className="mt-0.5 max-w-[220px] truncate text-[11px] text-[#6f7282]">
                          {row.documentTitle}
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[11px] text-[#a13a32]">
                          {t("noActiveDocument")}
                        </div>
                      )}
                    </Link>
                  </td>
                  {row.days.map((cell) => {
                    const isSelected =
                      row.documentId
                        ? selected.get(row.documentId)?.has(cell.date)
                        : false;
                    const interactable =
                      cell.status === "missing" || cell.status === "filled";
                    return (
                      <td
                        key={cell.date}
                        className="border-b border-[#ececf4] px-1.5 py-2 text-center align-middle"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            row.documentId &&
                            interactable &&
                            cell.status === "missing"
                              ? toggleCell(row.documentId, cell.date)
                              : null
                          }
                          disabled={
                            !row.documentId || cell.status !== "missing"
                          }
                          className={[
                            "inline-flex size-8 items-center justify-center rounded-lg border text-[11px] transition-all",
                            cell.status === "filled"
                              ? "border-[#c8f0d5] bg-[#ecfdf5] text-[#136b2a]"
                              : cell.status === "missing"
                                ? isSelected
                                  ? "border-[#5566f6] bg-[#5566f6] text-white shadow-[0_4px_14px_-6px_rgba(85,102,246,0.7)]"
                                  : "border-[#ffd2cd] bg-[#fff4f2] text-[#d2453d] hover:border-[#5566f6] hover:bg-[#eef1ff] hover:text-[#3848c7]"
                                : cell.status === "future"
                                  ? "border-dashed border-[#ececf4] bg-white text-[#dcdfed]"
                                  : cell.status === "out_of_period"
                                    ? "border-dashed border-[#ececf4] bg-[#fafbff] text-[#9b9fb3]"
                                    : "border-dashed border-[#ececf4] bg-white text-[#9b9fb3]",
                            cell.status !== "missing" || !row.documentId
                              ? "cursor-default"
                              : "cursor-pointer",
                          ].join(" ")}
                          title={
                            cell.status === "filled"
                              ? `${cell.date} — ${t("cellFilled")}${row.expectedRoster ? ` (${cell.filledCount}/${row.expectedRoster})` : ""}`
                              : cell.status === "missing"
                                ? `${cell.date} — ${t("cellMissing")}`
                                : cell.status === "future"
                                  ? `${cell.date} — ${t("cellFuture")}`
                                  : cell.status === "out_of_period"
                                    ? `${cell.date} — ${t("cellOutOfPeriod")}`
                                    : `${cell.date} — ${t("cellNoDocument")}`
                          }
                        >
                          {cell.status === "filled" ? (
                            <CheckCircle2 className="size-3.5" />
                          ) : cell.status === "missing" ? (
                            isSelected ? (
                              <CheckCircle2 className="size-3.5" />
                            ) : (
                              <XCircle className="size-3.5" />
                            )
                          ) : cell.status === "future" ? (
                            "·"
                          ) : (
                            "—"
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 text-[12px] text-[#6f7282]">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-md border border-[#c8f0d5] bg-[#ecfdf5]" />
          {t("legendFilled")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-md border border-[#ffd2cd] bg-[#fff4f2]" />
          {t("legendMissing")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-md border border-[#5566f6] bg-[#5566f6]" />
          {t("legendSelected")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-md border border-dashed border-[#ececf4] bg-white" />
          {t("legendFuture")}
        </span>
      </div>
    </div>
  );
}
