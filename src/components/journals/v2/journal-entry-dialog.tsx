"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Унифицированный «Add/Edit row» dialog в Design v2.
 *
 * Отличие от JournalSettingsModal:
 *   • Контент обычно — форма с TaskFillField'ами или native-input'ами
 *   • Footer слева опционально показывает «Удалить» (destructive,
 *     только в edit-mode)
 *   • CTA primary — «Сохранить запись» / «Создать запись»
 *
 * Использование:
 *
 *   <JournalEntryDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     mode={editing ? "edit" : "create"}
 *     onSave={handleSave}
 *     onDelete={editing ? handleDelete : undefined}
 *   >
 *     <Form fields />
 *   </JournalEntryDialog>
 */
export function JournalEntryDialog({
  open,
  onOpenChange,
  mode,
  title,
  description,
  children,
  onSave,
  onDelete,
  isSaving = false,
  saveDisabled = false,
  saveLabel,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  mode: "create" | "edit";
  /** Custom title; default — auto by mode. */
  title?: string;
  description?: string;
  children: ReactNode;
  onSave: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  isSaving?: boolean;
  saveDisabled?: boolean;
  /** Custom save button label. Default — «Сохранить» / «Создать запись». */
  saveLabel?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const t = useTranslations("journalUi.entryDialog");
  const tc = useTranslations("common");
  const sizeClass = {
    sm: "sm:max-w-[420px]",
    md: "sm:max-w-[560px]",
    lg: "sm:max-w-[720px]",
    xl: "sm:max-w-[900px]",
  }[size];
  const computedTitle =
    title ?? (mode === "edit" ? t("editTitle") : t("newTitle"));
  const computedSave =
    saveLabel ?? (mode === "edit" ? tc("save") : t("createEntry"));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={`max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-hidden rounded-[28px] border-0 p-0 ${sizeClass}`}
      >
        <DialogHeader className="shrink-0 border-b border-[#ececf4] bg-white px-6 py-5 sm:px-8 sm:py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024] sm:text-[22px]">
                {computedTitle}
              </DialogTitle>
              {description ? (
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#6f7282]">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-xl p-2 text-[#9b9fb3] transition-colors hover:bg-[#fafbff] hover:text-[#0b1024]"
              aria-label={tc("close")}
            >
              <X className="size-5" />
            </button>
          </div>
        </DialogHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5 sm:px-8 sm:py-6">
          {children}
        </div>
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-[#ececf4] bg-white px-6 py-4 sm:px-8">
          <div>
            {mode === "edit" && onDelete ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void onDelete()}
                disabled={isSaving}
                className="h-11 rounded-2xl border-[#ffd2cd] px-4 text-[14px] text-[#a13a32] shadow-none hover:bg-[#fff4f2]"
              >
                {tc("delete")}
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
              className="h-11 rounded-2xl border-[#dcdfed] px-4 text-[14px] text-[#0b1024] shadow-none hover:bg-[#fafbff]"
            >
              {tc("cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void onSave()}
              disabled={isSaving || saveDisabled}
              className="h-11 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_28px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]"
            >
              {isSaving ? tc("saving") : computedSave}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
