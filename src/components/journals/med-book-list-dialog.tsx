"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FloatingInputField } from "@/components/journals/journal-dialog-field";
import {
  JOURNAL_DIALOG_BODY_CLASS,
  JOURNAL_DIALOG_CONTENT_WIDE_CLASS,
  JOURNAL_DIALOG_FOOTER_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_SUBMIT_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
} from "@/components/journals/journal-responsive";

/** Что именно изменилось в списке — чтобы вызывающий перенёс данные ячеек. */
export type MedBookListChange = {
  /** Итоговый порядок колонок. */
  names: string[];
  /** Переименования: старый ключ → новый. */
  renames: { from: string; to: string }[];
  /** Удалённые колонки. */
  removed: string[];
};

type Item = { key: string; name: string; original: string | null };

let itemSeq = 0;
function nextKey() {
  itemSeq += 1;
  return `item-${itemSeq}`;
}

/**
 * Редактор справочника колонок журнала медкнижек.
 *
 * Эталон (lk.haccp-online.ru, med_books-grid.png) даёт под таблицами две
 * подчёркнутые ссылки — «Список специалистов и исследований» и «Список
 * прививок». Кликом открывается это окно: строки списка можно добавить,
 * переименовать и удалить. Поля — floating labels из
 * `journal-dialog-field.tsx`, как во всех остальных журналах.
 *
 * Переименование НЕ теряет проставленные даты: диалог возвращает не только
 * итоговый список, но и карту `renames`, по которой клиент переносит ключи
 * в `examinations` / `vaccinations` каждой строки сотрудника.
 */
export function MedBookListDialog({
  open,
  onOpenChange,
  title,
  description,
  items,
  itemLabel,
  addLabel,
  placeholder,
  reference,
  saving = false,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  items: string[];
  /** Подпись floating label у каждой строки. */
  itemLabel: string;
  addLabel: string;
  placeholder?: string;
  /** Справочная часть окна (периодичность осмотров / прививок). */
  reference?: ReactNode;
  saving?: boolean;
  onSave: (change: MedBookListChange) => void | Promise<void>;
}) {
  const t = useTranslations("journalUi.medBookList");
  const common = useTranslations("common");
  const controls = useTranslations("journalControls");
  const [draft, setDraft] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(false);

  // Пересобираем черновик при каждом открытии окна — без useEffect.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setError(null);
      setDraft(items.map((name) => ({ key: nextKey(), name, original: name })));
    }
  }

  function commit() {
    const names = draft.map((item) => item.name.trim()).filter(Boolean);
    if (names.length === 0) {
      setError(t("emptyError"));
      return;
    }
    if (new Set(names).size !== names.length) {
      setError(t("duplicateError"));
      return;
    }

    const renames = draft
      .filter(
        (item) =>
          item.original && item.name.trim() && item.original !== item.name.trim()
      )
      .map((item) => ({ from: item.original as string, to: item.name.trim() }));

    const kept = new Set(
      draft
        .filter((item) => item.original && item.name.trim())
        .map((item) => item.original as string)
    );
    const removed = items.filter((name) => !kept.has(name));

    void onSave({ names, renames, removed });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>{title}</DialogTitle>
        </DialogHeader>

        <div className={JOURNAL_DIALOG_BODY_CLASS}>
          <p className="text-[13px] leading-[1.5] text-[#6f7282]">{description}</p>

          <div className="space-y-3">
            {draft.map((item, index) => (
              <div key={item.key} className="flex items-start gap-2">
                <FloatingInputField
                  className="min-w-0 flex-1"
                  label={`${itemLabel} ${index + 1}`}
                  value={item.name}
                  placeholder={placeholder}
                  onChange={(value) => {
                    setError(null);
                    setDraft((current) =>
                      current.map((row) =>
                        row.key === item.key ? { ...row, name: value } : row
                      )
                    );
                  }}
                />
                <button
                  type="button"
                  aria-label={t("deleteItemAria", { name: item.name || controls("list.untitled") })}
                  title={t("deleteRow")}
                  onClick={() => {
                    setError(null);
                    setDraft((current) =>
                      current.filter((row) => row.key !== item.key)
                    );
                  }}
                  className="mt-1.5 shrink-0 rounded-xl p-2 text-[#9b9fb3] transition-colors duration-150 hover:bg-[#fff4f2] hover:text-[#a13a32] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>

          {error ? (
            <p className="text-[12.5px] leading-[1.35] text-[#e5484d]">{error}</p>
          ) : null}

          <Button
            type="button"
            variant="outline"
            className="h-10 gap-2 rounded-lg border-0 bg-[#5566f6]/[0.04] px-4 text-[14px] font-semibold text-[#5566f6] shadow-none transition-colors duration-150 hover:bg-[#5566f6]/[0.09]"
            onClick={() => {
              setError(null);
              setDraft((current) => [
                ...current,
                { key: nextKey(), name: "", original: null },
              ]);
            }}
          >
            <Plus className="size-4" />
            {addLabel}
          </Button>

          {reference ? (
            <details className="rounded-[14px] border border-[#ececf4] bg-[#fafbff] px-4 py-3">
              <summary className="cursor-pointer text-[13.5px] font-semibold text-[#0b1024]">
                {t("referenceSummary")}
              </summary>
              <div className="pt-3">{reference}</div>
            </details>
          ) : null}
        </div>

        <div className={JOURNAL_DIALOG_FOOTER_CLASS}>
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff]"
            onClick={() => onOpenChange(false)}
          >
            {common("cancel")}
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={commit}
            className={JOURNAL_DIALOG_SUBMIT_CLASS}
          >
            {saving ? common("saving") : common("save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
