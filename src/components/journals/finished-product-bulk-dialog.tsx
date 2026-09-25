"use client";

import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  JOURNAL_DIALOG_CONTENT_WIDE_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
} from "@/components/journals/journal-responsive";
import { TimeEntryField } from "@/components/journals/time-entry-field";
import {
  applyMenuPaste,
  applyPaste,
  emptyMenuRows,
  fillTimeBelow,
  isMultiCellPaste,
  parseDishYieldPaste,
  parseMenuPaste,
  type MenuRow,
} from "@/lib/finished-product-bulk";
import { cn } from "@/lib/utils";

/**
 * «Добавить изделия списком» бракеража готовой продукции — одно окно на
 * БЖГП пищеблока и на мастер-кабинет («Добавить в журналы на дату»):
 * таблица «Наименование | Выход [| Время]» со вставкой из Excel прямо в
 * ячейку + общие для всех изделий поля (их передаёт хозяин окна: у
 * пищеблока — поля строки журнала, у мастера — дата и оценка для всех
 * пищеблоков).
 */

/** Строка таблицы; yieldAuto — выход подставлен из меню мастер-кабинета. */
export type BulkDishRow = { name: string; yield: string; time: string; yieldAuto?: boolean };

export function emptyBulkDishRows(count: number): BulkDishRow[] {
  return emptyMenuRows(count);
}

const INPUT_CLASS =
  "h-10 w-full rounded-xl border px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

export function FinishedProductBulkTable({
  rows,
  onRowsChange,
  maxRows,
  showYield,
  showTime = false,
  fillYields,
  timePlaceholder = "Время",
}: {
  rows: BulkDishRow[];
  onRowsChange: (next: BulkDishRow[] | ((prev: BulkDishRow[]) => BulkDishRow[])) => void;
  maxRows: number;
  /** Колонка выхода видна в журнале. */
  showYield: boolean;
  /** Своё время изготовления у строки (мастер-кабинет); пусто — общее. */
  showTime?: boolean;
  /** Пустой выход строки — из меню мастера по наименованию. */
  fillYields?: (rows: BulkDishRow[]) => BulkDishRow[];
  timePlaceholder?: string;
}) {
  const fill = (next: BulkDishRow[]) => (fillYields ? fillYields(next) : next);
  const addCount = rows.filter((row) => row.name.trim() !== "").length;

  function update(index: number, patch: Partial<BulkDishRow>) {
    onRowsChange((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (patch.yield !== undefined) return { ...row, ...patch, yieldAuto: false };
        return fill([{ ...row, ...patch }])[0];
      })
    );
  }

  function remove(index: number) {
    onRowsChange((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0 ? next : emptyBulkDishRows(1);
    });
  }

  /** Вставка блока из Excel / списка в ячейку — заполняет вниз от этой строки. */
  function paste(event: React.ClipboardEvent<HTMLInputElement>, index: number) {
    const text = event.clipboardData.getData("text/plain");
    if (!isMultiCellPaste(text)) return;
    event.preventDefault();
    if (showTime) {
      const parsed = parseMenuPaste(text, maxRows);
      const columns = parsed.columns.filter((column) => column !== "yield" || showYield);
      if (parsed.rows.length === 0 || columns.length === 0) {
        if (parsed.columns.includes("yield")) toast.info("В журнале колонка выхода скрыта — вставьте наименования");
        return;
      }
      const count = Math.min(parsed.rows.length, maxRows - index);
      onRowsChange((prev) =>
        fill(
          (applyMenuPaste(prev as MenuRow[], index, { ...parsed, columns }, maxRows) as BulkDishRow[]).map((row, i) =>
            columns.includes("yield") && i >= index && i < index + count ? { ...row, yieldAuto: false } : row
          )
        )
      );
      toast.success(`Вставлено строк: ${count}`);
      return;
    }
    const parsed = parseDishYieldPaste(text);
    if (parsed.rows.length === 0) return;
    if (parsed.kind === "yields" && !showYield) {
      toast.info("В этом журнале колонка выхода скрыта — вставьте наименования");
      return;
    }
    const count = Math.min(parsed.rows.length, maxRows - index);
    onRowsChange((prev) =>
      fill(
        applyPaste<BulkDishRow>(prev, index, parsed)
          .slice(0, maxRows)
          .map((row, i) => ({
            ...row,
            time: row.time ?? "",
            // Вставленный выход — ручной, меню его не перезапишет.
            ...(parsed.kind !== "names" && i >= index && i < index + count ? { yieldAuto: false } : {}),
          }))
      )
    );
    toast.success(`Вставлено строк: ${count}`);
  }

  return (
    <div className="space-y-3" data-testid="bulk-dish-table">
      <div className="hidden items-center gap-2 px-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6f7282] sm:flex">
        <span className="w-6 shrink-0 text-center">№</span>
        <span className="min-w-0 flex-1">Наименование</span>
        {showYield ? <span className={cn("shrink-0", showTime ? "w-[120px]" : "w-[140px]")}>{showTime ? "Выход" : "Выход, г"}</span> : null}
        {showTime ? <span className="w-[176px] shrink-0">Время</span> : null}
        <span className="w-9 shrink-0" aria-hidden />
      </div>
      <ol className={cn("space-y-2", showTime ? "max-h-[min(46vh,480px)] overflow-y-auto overscroll-contain pr-0.5" : "")}>
        {rows.map((row, index) => {
          const n = index + 1;
          const orphan =
            row.name.trim() === "" && ((showYield && row.yield.trim() !== "") || (showTime && row.time.trim() !== ""));
          return (
            <li
              key={index}
              className={`rounded-2xl border p-2.5 transition-colors duration-150 sm:border-0 sm:bg-transparent sm:p-0 ${
                orphan ? "border-[#f3c9c2] bg-[#fff4f2]" : "border-[#ececf4] bg-[#fafbff]"
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-2.5 w-6 shrink-0 text-center text-[13px] font-medium tabular-nums text-[#9b9fb3]">{n}</span>
                <div className={cn("min-w-0 flex-1 gap-2", showTime ? "grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] sm:flex sm:flex-row" : "flex flex-col sm:flex-row")}>
                  <input
                    className={cn(
                      INPUT_CLASS,
                      "min-w-0 sm:flex-1",
                      showTime ? "col-span-2" : "",
                      orphan ? "border-[#e8a39a] bg-[#fff4f2]" : "border-[#dcdfed] bg-white"
                    )}
                    value={row.name}
                    maxLength={200}
                    placeholder={index === 0 ? "Например: Борщ" : "Наименование"}
                    aria-label={`Наименование, строка ${n}`}
                    onChange={(e) => update(index, { name: e.target.value })}
                    onPaste={(e) => paste(e, index)}
                    data-testid={`bulk-name-${index}`}
                  />
                  {showYield ? (
                    <input
                      className={cn(
                        INPUT_CLASS,
                        showTime ? "sm:w-[120px] sm:shrink-0" : "sm:w-[140px] sm:shrink-0",
                        row.yieldAuto ? "border-[#c8cdf7] bg-[#f5f6ff]" : "border-[#dcdfed] bg-white"
                      )}
                      title={row.yieldAuto ? "Выход из меню — исправьте, если иначе" : undefined}
                      data-yield-auto={row.yieldAuto ? "1" : undefined}
                      value={row.yield}
                      maxLength={20}
                      inputMode="decimal"
                      placeholder={index === 0 ? "250 или 200/10" : "Выход, г"}
                      aria-label={`Выход, строка ${n}`}
                      onChange={(e) => update(index, { yield: e.target.value })}
                      onPaste={(e) => paste(e, index)}
                      data-testid={`bulk-yield-${index}`}
                    />
                  ) : null}
                  {showTime ? (
                    <TimeEntryField
                      className={cn("sm:w-[176px] sm:shrink-0", showYield ? "" : "col-span-2")}
                      value={row.time}
                      onChange={(time) => update(index, { time })}
                      onFillBelow={() => onRowsChange((prev) => fillTimeBelow(prev, index))}
                      fillBelowDisabled={index >= rows.length - 1}
                      ariaLabel={`Время изготовления, строка ${n}`}
                      placeholder={timePlaceholder}
                      testId={`bulk-time-${index}`}
                      onPaste={(e) => paste(e, index)}
                    />
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label={`Удалить строку ${n}`}
                  title="Удалить строку"
                  onClick={() => remove(index)}
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-[#9b9fb3] transition-colors duration-150 hover:bg-[#fff4f2] hover:text-[#a13a32] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  <X className="size-4" />
                </button>
              </div>
              {orphan ? (
                <p className="mt-1.5 pl-8 text-[12px] leading-snug text-[#a13a32]">нет наименования — строка не добавится</p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onRowsChange((prev) => (prev.length >= maxRows ? prev : [...prev, ...emptyBulkDishRows(1)]))}
          disabled={rows.length >= maxRows}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-dashed border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-4" />
          Ещё строка
        </button>
        <span className="rounded-full bg-[#f5f6ff] px-3 py-1 text-[13px] text-[#3848c7]" data-testid="bulk-dish-count">
          Будет добавлено: <span className="font-semibold tabular-nums">{addCount}</span>
        </span>
      </div>
      <p className="text-[12px] leading-[1.45] text-[#6f7282]">
        {showTime
          ? showYield
            ? "Можно вставить из Excel сразу три столбца — наименование, выход и время: встаньте в первую ячейку и нажмите Ctrl+V. Время можно набирать без двоеточия: 0830 → 08:30."
            : "Можно вставить из Excel наименования и время: встаньте в первую ячейку и нажмите Ctrl+V. Время можно набирать без двоеточия: 0830 → 08:30."
          : showYield
            ? "Можно вставить из Excel сразу два столбца — наименование и выход: встаньте в первую ячейку и нажмите Ctrl+V."
            : "Можно вставить из Excel или из списка столбец наименований: встаньте в первую ячейку и нажмите Ctrl+V."}
      </p>
    </div>
  );
}

/** Окно: заголовок → [сверху] → таблица → «Общие для всех изделий» → поля → кнопки. */
export function FinishedProductBulkDialog({
  open,
  onOpenChange,
  title = "Добавить изделия списком",
  description,
  top,
  table,
  commonFields,
  submitLabel = "Добавить",
  submitDisabled,
  submitting = false,
  onSubmit,
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: React.ReactNode;
  /** Над таблицей: пояснение, «Взять меню». */
  top?: React.ReactNode;
  table: React.ReactNode;
  commonFields: React.ReactNode;
  submitLabel?: React.ReactNode;
  submitDisabled?: boolean;
  submitting?: boolean;
  onSubmit: () => void;
  testId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS} data-testid={testId}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Таблица изделий: наименование и выход, общие поля — для всех строк.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(92vh-160px)] min-w-0 space-y-5 overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-6">
          {description ? <div className="text-[13px] leading-[1.55] text-[#3c4053]">{description}</div> : null}
          {top}
          {table}
          <div className="border-t border-[#ececf4] pt-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Общие для всех изделий
          </div>
          {commonFields}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none transition-colors hover:bg-[#fafbff] sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] sm:w-auto"
            onClick={onSubmit}
            disabled={submitDisabled || submitting}
            data-testid={testId ? `${testId}-submit` : undefined}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
