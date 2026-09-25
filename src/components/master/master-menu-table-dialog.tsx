"use client";

import { useEffect, useMemo, useState } from "react";
import { ListChecks, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { RecognizeFromPhoto } from "@/components/ai/recognize-from-photo";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  JOURNAL_DIALOG_CONTENT_WIDE_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
} from "@/components/journals/journal-responsive";
import { TimeEntryField, isBadTypedTime } from "@/components/journals/time-entry-field";
import { mergeMenuItemsIntoRows } from "@/lib/ai-vision/merge";
import type { VisionMenuItem } from "@/lib/ai-vision/shared";
import {
  applyMenuPaste,
  emptyMenuRows,
  fillTimeBelow,
  isMultiCellPaste,
  menuRowsToSave,
  normalizeTypedTime,
  parseMenuPaste,
  setTimeForAll,
  type MenuRow,
} from "@/lib/finished-product-bulk";
import type { SharedItem } from "@/lib/master-directory";
import { pluralRu } from "@/lib/plural-ru";
import { cn } from "@/lib/utils";

/** Как `SHARED_ITEMS_MAX` в master-directory.ts (там серверный модуль с БД). */
export const MASTER_MENU_ROWS_MAX = 5000;
/** Рисуем строки порциями: меню бывает на тысячи позиций. */
const RENDER_CHUNK = 200;
const START_EMPTY_ROWS = 5;

const INPUT =
  "h-10 w-full rounded-xl border px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

function rowsFromItems(items: SharedItem[]): MenuRow[] {
  const rows = items.map((item) => ({ name: item.name, yield: item.portion ?? "", time: item.time ?? "" }));
  // Пустая строка в конце — сразу дописать новое блюдо или вставить из Excel.
  return rows.length > 0 ? [...rows, ...emptyMenuRows(1)] : emptyMenuRows(START_EMPTY_ROWS);
}

/** Время введено, но не распознаётся даже без двоеточия — подсветим, в список оно не уйдёт. */
function badTime(value: string): boolean {
  return isBadTypedTime(value);
}

/**
 * «Вставить списком» для меню мастер-кабинета — таблица «Наименование |
 * Выход | Время», как «Добавить списком» в БЖГП: вставка столбцов из Excel
 * прямо в ячейку, строки добавляются и удаляются. Открывается с текущим
 * списком: удалили строку — позиция уберётся из меню.
 */
export function MasterMenuTableDialog({
  open,
  items,
  onClose,
  onSubmit,
}: {
  open: boolean;
  items: SharedItem[];
  onClose: () => void;
  /** Строки к сохранению → предпросмотр; true — окно можно закрыть. */
  onSubmit: (rows: MenuRow[]) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<MenuRow[]>(() => rowsFromItems(items));
  const [shown, setShown] = useState(RENDER_CHUNK);
  const [submitting, setSubmitting] = useState(false);
  /** «Время для всех строк» — одно время каждой строке. */
  const [allTime, setAllTime] = useState("");

  // Каждое открытие — заново с текущим списком мастера.
  useEffect(() => {
    if (!open) return;
    setRows(rowsFromItems(items));
    setShown(RENDER_CHUNK);
  }, [open, items]);

  const toSave = useMemo(() => menuRowsToSave(rows), [rows]);
  const withYield = toSave.filter((row) => row.yield !== "").length;
  const withTime = toSave.filter((row) => row.time !== "").length;
  const badTimes = rows.filter((row) => badTime(row.time)).length;
  const visible = rows.slice(0, shown);

  function update(index: number, patch: Partial<MenuRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function remove(index: number) {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0 ? next : emptyMenuRows(1);
    });
  }

  function addRow() {
    setRows((prev) => (prev.length >= MASTER_MENU_ROWS_MAX ? prev : [...prev, ...emptyMenuRows(1)]));
    setShown((value) => Math.max(value, rows.length + 1));
  }

  /** «С фото»: распознанные блюда — в пустые строки, потом в конец меню. */
  function addFromPhoto(items: VisionMenuItem[]) {
    const result = mergeMenuItemsIntoRows(rows, items, {
      maxRows: MASTER_MENU_ROWS_MAX,
      withYield: true,
      withTime: true,
      make: (values) => values,
    });
    setRows(result.rows);
    setShown((value) => Math.max(value, result.rows.length));
    return result;
  }

  /** Блок из Excel / списка в ячейку — заполняет вниз от этой строки. */
  function paste(event: React.ClipboardEvent<HTMLInputElement>, index: number) {
    const text = event.clipboardData.getData("text/plain");
    if (!isMultiCellPaste(text)) return;
    event.preventDefault();
    const parsed = parseMenuPaste(text, MASTER_MENU_ROWS_MAX);
    if (parsed.rows.length === 0) return;
    const count = Math.min(parsed.rows.length, MASTER_MENU_ROWS_MAX - index);
    setRows((prev) => applyMenuPaste(prev, index, parsed, MASTER_MENU_ROWS_MAX));
    setShown((value) => Math.max(value, index + count + 1));
    const what = parsed.columns
      .map((column) => (column === "name" ? "наименование" : column === "yield" ? "выход" : "время"))
      .join(", ");
    toast.success(`Вставлено строк: ${count} (${what})`);
  }

  async function submit() {
    if (toSave.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      if (await onSubmit(toSave)) onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS} data-testid="master-menu-table-dialog">
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>Меню списком</DialogTitle>
          <DialogDescription className="sr-only">
            Таблица меню: наименование, выход и время изготовления. Можно вставить столбцы из Excel.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-3 px-4 py-4 sm:px-6 sm:py-5">
          <p className="text-[13px] leading-[1.55] text-[#3c4053]">
            Встаньте в ячейку и нажмите Ctrl+V — из Excel можно вставить сразу три столбца: наименование, выход и
            время (или только наименования). Меню на бумаге — «С фото» внизу. В таблице уже текущее меню: удалите
            строку — блюдо уберётся из меню.
          </p>

          <div className="flex flex-col gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3 sm:flex-row sm:items-center">
            <span className="shrink-0 text-[13px] font-medium text-[#3c4053]">Время для всех строк</span>
            <TimeEntryField
              className="sm:w-[176px]"
              value={allTime}
              onChange={setAllTime}
              ariaLabel="Время для всех строк"
              placeholder="08:00"
              testId="menu-time-all"
            />
            <button
              type="button"
              disabled={!normalizeTypedTime(allTime)}
              onClick={() => {
                const time = normalizeTypedTime(allTime);
                setRows((prev) => setTimeForAll(prev, time));
                toast.success(`Время ${time} — всем строкам`);
              }}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="menu-time-all-apply"
            >
              <ListChecks className="size-4" />
              Проставить всем
            </button>
            <span className="text-[12px] leading-snug text-[#6f7282]">Можно без двоеточия: 0830 → 08:30.</span>
          </div>

          <div
            className="hidden items-center gap-2 px-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6f7282] sm:flex"
            aria-hidden
          >
            <span className="w-8 shrink-0 text-center">№</span>
            <span className="min-w-0 flex-1">Наименование</span>
            <span className="w-[120px] shrink-0">Выход</span>
            <span className="w-[176px] shrink-0">Время</span>
            <span className="w-9 shrink-0" />
          </div>

          <ol className="max-h-[min(52vh,520px)] space-y-2 overflow-y-auto overscroll-contain pr-0.5" data-testid="master-menu-table">
            {visible.map((row, index) => {
              const n = index + 1;
              const orphan = row.name.trim() === "" && (row.yield.trim() !== "" || row.time.trim() !== "");
              const wrongTime = badTime(row.time);
              return (
                <li
                  key={index}
                  className={cn(
                    "rounded-2xl border p-2.5 transition-colors duration-150 sm:border-0 sm:bg-transparent sm:p-0",
                    orphan ? "border-[#f3c9c2] bg-[#fff4f2]" : "border-[#ececf4] bg-[#fafbff]"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-2.5 w-8 shrink-0 text-center text-[13px] font-medium tabular-nums text-[#9b9fb3]">
                      {n}
                    </span>
                    <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-2 sm:flex sm:flex-row">
                      <input
                        className={cn(
                          INPUT,
                          "col-span-2 min-w-0 sm:flex-1",
                          orphan ? "border-[#e8a39a] bg-[#fff4f2]" : "border-[#dcdfed] bg-white"
                        )}
                        value={row.name}
                        maxLength={200}
                        placeholder={index === 0 ? "Например: Борщ со сметаной" : "Наименование"}
                        aria-label={`Наименование, строка ${n}`}
                        onChange={(event) => update(index, { name: event.target.value })}
                        onPaste={(event) => paste(event, index)}
                        data-testid={`menu-name-${index}`}
                      />
                      <input
                        className={cn(INPUT, "border-[#dcdfed] bg-white sm:w-[120px] sm:shrink-0")}
                        value={row.yield}
                        maxLength={20}
                        inputMode="decimal"
                        placeholder={index === 0 ? "250 или 200/10" : "Выход"}
                        aria-label={`Выход, строка ${n}`}
                        onChange={(event) => update(index, { yield: event.target.value })}
                        onPaste={(event) => paste(event, index)}
                        data-testid={`menu-yield-${index}`}
                      />
                      <TimeEntryField
                        className="sm:w-[176px] sm:shrink-0"
                        value={row.time}
                        onChange={(time) => update(index, { time })}
                        onFillBelow={() => {
                          setRows((prev) => fillTimeBelow(prev, index));
                          setShown((value) => Math.max(value, rows.length));
                        }}
                        fillBelowDisabled={index >= rows.length - 1}
                        ariaLabel={`Время изготовления, строка ${n}`}
                        placeholder={index === 0 ? "08:30" : "Время"}
                        testId={`menu-time-${index}`}
                        onPaste={(event) => paste(event, index)}
                      />
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
                    <p className="mt-1.5 pl-10 text-[12px] leading-snug text-[#a13a32]">
                      нет наименования — строка не сохранится
                    </p>
                  ) : wrongTime ? (
                    <p className="mt-1.5 pl-10 text-[12px] leading-snug text-[#a13a32]">
                      время — в виде ЧЧ:ММ, например 08:30 (можно 0830)
                    </p>
                  ) : null}
                </li>
              );
            })}
            {rows.length > visible.length ? (
              <li className="flex justify-center py-1">
                <button
                  type="button"
                  onClick={() => setShown((value) => value + RENDER_CHUNK)}
                  className="inline-flex h-10 items-center rounded-xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                >
                  Показать ещё {Math.min(RENDER_CHUNK, rows.length - visible.length)} из {rows.length - visible.length}
                </button>
              </li>
            ) : null}
          </ol>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <button
                type="button"
                onClick={addRow}
                disabled={rows.length >= MASTER_MENU_ROWS_MAX}
                className="inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[#dcdfed] bg-white px-4 text-[15px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:flex-none sm:rounded-xl sm:text-[14px]"
              >
                <Plus className="size-4" />
                Ещё строка
              </button>
              <RecognizeFromPhoto
                kind="menu"
                onItems={addFromPhoto}
                resultLabel="В меню добавлено"
                className="flex-1 sm:flex-none"
                testId="menu-photo"
              />
            </div>
            <span className="rounded-full bg-[#f5f6ff] px-3 py-1 text-[13px] text-[#3848c7]" data-testid="master-menu-table-count">
              В меню: <span className="font-semibold tabular-nums">{toSave.length}</span>
              {toSave.length > 0 ? (
                <span className="text-[#6f7282]">
                  {" "}
                  · с выходом {withYield} · со временем {withTime}
                </span>
              ) : null}
            </span>
          </div>
          {badTimes > 0 ? (
            <p className="rounded-xl bg-[#fff4f2] px-3 py-2 text-[12.5px] leading-snug text-[#a13a32]">
              {badTimes} {pluralRu(badTimes, "строка", "строки", "строк")} с непонятным временем — оно не сохранится.
              Исправьте (например 08:30 или 0830) или сотрите.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-[#ececf4] bg-white px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#3c4053] transition-colors hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={toSave.length === 0 || submitting}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="master-menu-table-submit"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Показать изменения
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
