"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Download, Plus, RotateCcw, SlidersHorizontal, X } from "lucide-react";

import { BlankDownloadClient } from "@/components/public/blank-download-client";
import { BLANK_LAYOUT_LIMITS, defaultBlankLayout, normalizeBlankLayout, type BlankLayout } from "@/lib/blank-layout";

/**
 * Конструктор бланка (спека journal-page-engagement-2026-11): название,
 * колонки и число строк — и PDF через обычное окно с почтой. Сначала
 * свёрнут: одна строка с кнопкой «Настроить», чтобы не мешать тем, кому
 * нужен готовый бланк.
 */
export function BlankConstructorClient({ code, title }: { code: string; title: string }) {
  const t = useTranslations("blankConstructor");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BlankLayout>(() => defaultBlankLayout(code, title));
  const layout = normalizeBlankLayout(draft);

  function setColumn(index: number, value: string) {
    setDraft((prev) => ({ ...prev, columns: prev.columns.map((column, i) => (i === index ? value.slice(0, BLANK_LAYOUT_LIMITS.columnMax) : column)) }));
  }
  function move(index: number, delta: number) {
    setDraft((prev) => {
      const next = [...prev.columns];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, columns: next };
    });
  }
  function remove(index: number) {
    setDraft((prev) => (prev.columns.length <= BLANK_LAYOUT_LIMITS.columnsMin ? prev : { ...prev, columns: prev.columns.filter((_, i) => i !== index) }));
  }
  function add() {
    setDraft((prev) => (prev.columns.length >= BLANK_LAYOUT_LIMITS.columnsMax ? prev : { ...prev, columns: [...prev.columns, ""] }));
  }

  const previewColumns = draft.columns.map((column) => column.trim()).filter(Boolean);

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-7" data-testid="blank-constructor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
            <SlidersHorizontal aria-hidden="true" className="size-5 text-[#5566f6]" />
            {t("heading")}
          </h2>
          <p className="mt-1 text-[14px] leading-[1.55] text-[#6f7282]">{t("lead")}</p>
        </div>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            data-testid="blank-constructor-open"
          >
            {t("open")}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-4">
            <label className="block">
              <span className="text-[13px] font-medium text-[#3c4053]">{t("titleLabel")}</span>
              <input
                value={draft.title}
                maxLength={BLANK_LAYOUT_LIMITS.titleMax}
                onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                className="mt-1 h-11 w-full rounded-xl border border-[#dcdfed] px-3 text-[15px] text-[#0b1024] outline-none focus:border-[#5566f6]"
                data-testid="blank-constructor-title"
              />
            </label>

            <div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium text-[#3c4053]">{t("columnsLabel")}</span>
                <span className="text-[12px] text-[#9b9fb3]">{t("columnsLimit", { max: BLANK_LAYOUT_LIMITS.columnsMax })}</span>
              </div>
              <ol className="mt-1 space-y-1.5">
                {draft.columns.map((column, index) => (
                  <li key={index} className="flex items-center gap-1.5">
                    <span className="w-5 shrink-0 text-right text-[12px] tabular-nums text-[#9b9fb3]">{index + 1}</span>
                    <input
                      value={column}
                      placeholder={t("columnPlaceholder")}
                      aria-label={t("columnAria", { index: index + 1 })}
                      onChange={(event) => setColumn(index, event.target.value)}
                      className="h-10 min-w-0 flex-1 rounded-xl border border-[#dcdfed] px-3 text-[14px] text-[#0b1024] outline-none focus:border-[#5566f6]"
                      data-testid="blank-constructor-column"
                    />
                    <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t("moveUp")} className="grid size-9 place-items-center rounded-lg text-[#6f7282] hover:bg-[#f5f6ff] disabled:opacity-30">
                      <ArrowUp className="size-4" />
                    </button>
                    <button type="button" onClick={() => move(index, 1)} disabled={index === draft.columns.length - 1} aria-label={t("moveDown")} className="grid size-9 place-items-center rounded-lg text-[#6f7282] hover:bg-[#f5f6ff] disabled:opacity-30">
                      <ArrowDown className="size-4" />
                    </button>
                    <button type="button" onClick={() => remove(index)} disabled={draft.columns.length <= BLANK_LAYOUT_LIMITS.columnsMin} aria-label={t("removeColumn")} className="grid size-9 place-items-center rounded-lg text-[#6f7282] hover:bg-[#fdf2f7] hover:text-[#d6408a] disabled:opacity-30">
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ol>
              {draft.columns.length < BLANK_LAYOUT_LIMITS.columnsMax ? (
                <button type="button" onClick={add} className="mt-2 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#3848c7] hover:underline" data-testid="blank-constructor-add">
                  <Plus className="size-4" />
                  {t("addColumn")}
                </button>
              ) : null}
            </div>

            <label className="block">
              <span className="text-[13px] font-medium text-[#3c4053]">{t("rowsLabel", { rows: draft.rows })}</span>
              <input
                type="range"
                min={BLANK_LAYOUT_LIMITS.rowsMin}
                max={BLANK_LAYOUT_LIMITS.rowsMax}
                step={1}
                value={draft.rows}
                onChange={(event) => setDraft((prev) => ({ ...prev, rows: Number(event.target.value) }))}
                className="mt-2 w-full accent-[#5566f6]"
                data-testid="blank-constructor-rows"
              />
            </label>
          </div>

          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[#3c4053]">{t("preview")}</div>
            <div className="mt-1 overflow-x-auto rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
              <div className="text-center text-[13px] font-semibold text-[#0b1024]">{draft.title.trim() || t("untitled")}</div>
              <table className="mt-2 w-full min-w-[420px] border-collapse bg-white text-[11px]" data-testid="blank-constructor-preview">
                <thead>
                  <tr>
                    <th className="w-7 border border-[#9b9fb3] bg-[#f2f2f2] px-1 py-1 font-semibold">№</th>
                    {previewColumns.map((column, index) => (
                      <th key={`${index}-${column}`} className="border border-[#9b9fb3] bg-[#f2f2f2] px-1 py-1 font-semibold">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3].map((row) => (
                    <tr key={row}>
                      <td className="h-6 border border-[#9b9fb3] text-center text-[#6f7282]">{row}</td>
                      {previewColumns.map((column, index) => (
                        <td key={`${index}-${column}`} className="border border-[#9b9fb3]" />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-1 text-center text-[11px] text-[#9b9fb3]">{t("previewMore", { rows: draft.rows })}</div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {layout ? (
                <BlankDownloadClient
                  target={{ kind: "code", code }}
                  format="pdf"
                  title={layout.title}
                  layout={layout}
                  place="journal-constructor"
                  className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
                >
                  <Download className="size-4" />
                </BlankDownloadClient>
              ) : (
                <span className="text-[13px] text-[#a3245f]">{t("invalid", { min: BLANK_LAYOUT_LIMITS.columnsMin })}</span>
              )}
              <button
                type="button"
                onClick={() => setDraft(defaultBlankLayout(code, title))}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#6f7282] hover:text-[#0b1024]"
              >
                <RotateCcw className="size-3.5" />
                {t("reset")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
