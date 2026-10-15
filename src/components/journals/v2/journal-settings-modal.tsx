"use client";

import { useTranslations } from "next-intl";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Унифицированная модалка «Настройки журнала» в Design v2.
 *
 * Структура:
 *   ┌── Header (sticky) ──────────────────────────┐
 *   │ Title                              [X]      │
 *   ├── Body (scroll если нужно) ─────────────────┤
 *   │ children                                    │
 *   ├── Footer (sticky) ──────────────────────────┤
 *   │                  [Отмена]  [Сохранить]      │
 *   └─────────────────────────────────────────────┘
 *
 * Высота не больше 90vh, body — overflow-y-auto. Header и footer
 * shrink-0. Это match с правилами WhatsNewModal в CLAUDE.md.
 *
 * Использование:
 *
 *   <JournalSettingsModal
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="Настройки журнала уборки"
 *     onSave={handleSave}
 *     isSaving={isSaving}
 *     saveLabel="Сохранить"  // optional
 *   >
 *     <Field />
 *     <Field />
 *   </JournalSettingsModal>
 */
export function JournalSettingsModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSave,
  onCancel,
  saveLabel,
  cancelLabel,
  isSaving = false,
  saveDisabled = false,
  /** Если задан — рендерим как destructive button слева от save. */
  destructiveAction,
  /** Размер sm/md/lg/xl — соответствует max-w-{value}. */
  size = "lg",
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  onSave?: () => void | Promise<void>;
  onCancel?: () => void;
  saveLabel?: string;
  cancelLabel?: string;
  isSaving?: boolean;
  saveDisabled?: boolean;
  destructiveAction?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const t = useTranslations("journalControls.settingsModal");
  const sizeClass = {
    sm: "sm:max-w-[420px]",
    md: "sm:max-w-[560px]",
    lg: "sm:max-w-[720px]",
    xl: "sm:max-w-[900px]",
  }[size];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Свой крестик в шапке — встроенный не нужен, иначе их два.
        showCloseButton={false}
        // ВАЖНО: shadcn DialogContent по умолчанию использует `display: grid`
        // — в нём `flex-1` на body не работает и body растёт по контенту,
        // прорывая `max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh]` (контент клипается, не скроллится).
        // Принудительно делаем flex column, чтобы header/footer shrink-0
        // и body flex-1 overflow-y-auto работали как задумано.
        className={`flex max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-[28px] border-0 p-0 gap-0 ${sizeClass}`}
      >
        <DialogHeader className="shrink-0 border-b border-[#ececf4] bg-white px-6 py-5 sm:px-8 sm:py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024] sm:text-[22px]">
                {title}
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
              aria-label={t("close")}
            >
              <X className="size-5" />
            </button>
          </div>
        </DialogHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 sm:px-8 sm:py-6">
          {children}
        </div>
        {(onSave || onCancel || destructiveAction) ? (
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-[#ececf4] bg-white px-6 py-4 sm:px-8">
            <div>{destructiveAction}</div>
            <div className="flex flex-wrap items-center gap-2">
              {onCancel ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel}
                  className="h-11 rounded-2xl border-[#dcdfed] px-4 text-[14px] text-[#0b1024] shadow-none hover:bg-[#fafbff]"
                >
                  {cancelLabel ?? t("cancel")}
                </Button>
              ) : null}
              {onSave ? (
                <Button
                  type="button"
                  onClick={() => void onSave()}
                  disabled={isSaving || saveDisabled}
                  className="h-11 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_28px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]"
                >
                  {isSaving ? t("saving") : saveLabel ?? t("save")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
