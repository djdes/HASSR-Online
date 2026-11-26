"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PPK_COMPARE_ERROR_CODES, ppkErrorText } from "@/lib/ppk/api-errors";
import { GitCompareArrows, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { DiffResult } from "@/lib/ppk/revision-diff";
import type { RevisionInfo } from "@/lib/ppk/revisions";
import { PPK_BUTTON_TEXT_CLASS } from "@/components/production-control/ppk-ui";

const API = "/api/production-control/revisions/compare";
/** Длинный неизменённый кусок сворачивается до краёв. */
const COLLAPSE_AT = 700;
const EDGE = 220;

type Side = { kind: "revision"; number: number } | { kind: "current" };
type CompareResponse = {
  docKey: string;
  title: string;
  history: (RevisionInfo & { hasContent: boolean })[];
  currentAvailable: boolean;
  from: Side;
  to: Side;
  unavailable: "from" | "to" | null;
  diff: DiffResult | null;
};

function shortDate(iso: string, timeZone: string): string {
  const options = { day: "2-digit", month: "2-digit", year: "numeric" } as const;
  try {
    return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: "Europe/Moscow" }).format(new Date(iso));
  }
}

const sideValue = (side: Side) => (side.kind === "current" ? "current" : String(side.number));

/**
 * Окно «Сравнение редакций» (владелец, 2026-11-25): «было» и «стало» —
 * редакции документа или текущий текст; добавленное — зелёным, удалённое —
 * красным зачёркнутым. Пробелы и переносы правкой не считаются.
 */
export function RevisionCompareDialog({
  docKey,
  open,
  onClose,
  timeZone,
  initialFrom,
  initialTo,
}: {
  docKey: string;
  open: boolean;
  onClose: () => void;
  timeZone: string;
  initialFrom?: number;
  initialTo?: number | "current";
}) {
  const t = useTranslations("productionControl.revisions.compare");
  const [query, setQuery] = useState<{ from?: number; to?: number | "current" }>({ from: initialFrom, to: initialTo });
  const [data, setData] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const params = new URLSearchParams({ docKey });
    if (query.from !== undefined) params.set("from", String(query.from));
    if (query.to !== undefined) params.set("to", String(query.to));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка сравнения с сервера при открытии и смене редакций
    setLoading(true);
    setError(null);
    fetch(`${API}?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (CompareResponse & { error?: string; code?: string }) | null;
        if (!alive) return;
        if (!response.ok || !body?.history) {
          // Текст по коду — на языке интерфейса; неизвестный код — текст сервера.
          setError(ppkErrorText(body, PPK_COMPARE_ERROR_CODES, (key) => t(`errors.${key}`), t("failed")));
          return;
        }
        setData(body);
      })
      .catch(() => alive && setError(t("failed")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, docKey, query, t]);

  const history = data?.history ?? [];
  const label = (item: RevisionInfo) => t("option", { code: item.code, date: shortDate(item.approvedAt, timeZone) });
  const codeOf = (side: Side | undefined) =>
    side?.kind === "revision" ? (history.find((item) => item.number === side.number)?.code ?? "") : t("current");

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-[860px] flex-col gap-0 overflow-hidden p-0" data-revision-compare>
        <DialogHeader className="shrink-0 gap-0 px-5 pt-4 pb-2 pr-14 text-left">
          <DialogTitle className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">
            {t("title", { title: data?.title ?? "" })}
          </DialogTitle>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-end gap-3 px-5 pb-3">
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[12.5px] font-medium text-[#6f7282]">
            {t("from")}
            <select
              value={data ? sideValue(data.from) : ""}
              disabled={!data || loading}
              onChange={(event) => setQuery({ from: Number(event.target.value), to: data?.to.kind === "current" ? "current" : data?.to.number })}
              className="h-10 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              data-compare-from
            >
              {history.map((item) => (
                <option key={item.number} value={item.number}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[12.5px] font-medium text-[#6f7282]">
            {t("to")}
            <select
              value={data ? sideValue(data.to) : ""}
              disabled={!data || loading}
              onChange={(event) =>
                setQuery({
                  from: data?.from.kind === "revision" ? data.from.number : undefined,
                  to: event.target.value === "current" ? "current" : Number(event.target.value),
                })
              }
              className="h-10 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              data-compare-to
            >
              {data?.currentAvailable ? <option value="current">{t("current")}</option> : null}
              {history.map((item) => (
                <option key={item.number} value={item.number}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-5">
          {loading && !data ? (
            <p className="flex items-center gap-2 text-[14px] text-[#6f7282]">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("loading")}
            </p>
          ) : error ? (
            <p className="text-[14px] text-[#a13a32]" role="alert">
              {error}
            </p>
          ) : data?.unavailable ? (
            <p className="rounded-2xl bg-[#fff7e6] px-4 py-3 text-[14px] text-[#b45309]" data-compare-unavailable>
              {t("noContent", { code: codeOf(data.unavailable === "from" ? data.from : data.to) })}
            </p>
          ) : data?.diff ? (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[#3c4053]" data-compare-summary>
                <span className="font-medium text-[#0b1024]">
                  {data.diff.added + data.diff.removed === 0
                    ? t("same")
                    : t("summary", { added: String(data.diff.added), removed: String(data.diff.removed) })}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ins className="rounded bg-[#ecfdf5] px-1 text-[#116b2a] no-underline">{t("legendAdded")}</ins>
                  <del className="rounded bg-[#fef2f2] px-1 text-[#a13a32]">{t("legendRemoved")}</del>
                </span>
                {data.diff.mode === "lines" ? <span className="text-[#6f7282]">{t("byLines")}</span> : null}
                {data.diff.mode === "whole" ? <span className="text-[#6f7282]">{t("whole")}</span> : null}
                <label className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] text-[#6f7282]">
                  <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
                  {t("showAll")}
                </label>
              </div>
              <div
                className="whitespace-pre-wrap break-words rounded-2xl bg-[var(--app-veil)] px-4 py-3 text-[14px] leading-relaxed text-[#0b1024]"
                data-compare-body
              >
                {data.diff.segments.map((segment, index) =>
                  segment.op === "add" ? (
                    <ins key={index} className="rounded bg-[#ecfdf5] text-[#116b2a] no-underline" data-diff="add">
                      {segment.text}
                    </ins>
                  ) : segment.op === "del" ? (
                    <del key={index} className="rounded bg-[#fef2f2] text-[#a13a32]" data-diff="del">
                      {segment.text}
                    </del>
                  ) : !showAll && segment.text.length > COLLAPSE_AT ? (
                    <span key={index}>
                      {index > 0 ? segment.text.slice(0, EDGE) : null}
                      <span className="mx-1 inline-block rounded-lg bg-white px-2 text-[12.5px] text-[#6f7282]">
                        {t("collapsed", {
                          count: String(segment.text.length - (index > 0 ? EDGE : 0) - (index < data.diff!.segments.length - 1 ? EDGE : 0)),
                        })}
                      </span>
                      {index < data.diff!.segments.length - 1 ? segment.text.slice(-EDGE) : null}
                    </span>
                  ) : (
                    <span key={index}>{segment.text}</span>
                  ),
                )}
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Кнопка «Сравнить» с окном; без `from`/`to` сервер выбирает пару сам. */
export function RevisionCompareButton({
  docKey,
  timeZone,
  from,
  to,
  label,
  className,
}: {
  docKey: string;
  timeZone: string;
  from?: number;
  to?: number | "current";
  label?: string;
  className?: string;
}) {
  const t = useTranslations("productionControl.revisions.compare");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(PPK_BUTTON_TEXT_CLASS, className)} data-revision-compare-open>
        <GitCompareArrows className="size-4" aria-hidden />
        {label ?? t("open")}
      </button>
      {open ? (
        <RevisionCompareDialog docKey={docKey} open={open} onClose={() => setOpen(false)} timeZone={timeZone} initialFrom={from} initialTo={to} />
      ) : null}
    </>
  );
}
