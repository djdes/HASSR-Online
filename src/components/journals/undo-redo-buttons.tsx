"use client";

import { Redo2, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Контракт кнопок отмены. Проп опциональный: журналы, где отмена ещё
 * не подключена, ничего не передают — и шапка выглядит как раньше.
 */
export type DocumentBarUndo = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Сколько правок можно откатить — бейджем на кнопке. */
  undoCount?: number;
};

/**
 * Иконочная кнопка шапки. `relative` — под бейдж-счётчик отмены,
 * disabled приглушается, чтобы «отменять нечего» читалось без тултипа.
 */
export const UNDO_ICON_BUTTON_CLASS =
  "relative flex size-9 items-center justify-center rounded-lg border-0 bg-[#5566f6]/[0.04] text-[#5566f6] transition-colors duration-150 hover:bg-[#5566f6]/[0.09] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:bg-[#f5f6ff] disabled:text-[#c3c6d6] disabled:hover:bg-[#f5f6ff]";

/**
 * Пара «Отменить / Повторить».
 *
 * Живёт отдельным компонентом, потому что `DocumentActionsBar` есть не у
 * всех журналов: у med-book/tracked/pest-control и других — своя шапка,
 * и им нужны ровно те же кнопки, а не их копия с другим отступом.
 */
export function UndoRedoButtons({
  undo,
  className,
}: {
  undo: DocumentBarUndo;
  className?: string;
}) {
  const t = useTranslations("journals.ui.undoRedo");
  return (
    <div className={className ?? "flex items-center gap-1.5"}>
      <button
        type="button"
        onClick={undo.onUndo}
        disabled={!undo.canUndo}
        aria-label={t("undoAria")}
        title={t("undoTitle")}
        className={UNDO_ICON_BUTTON_CLASS}
      >
        <Undo2 className="size-4" />
        {undo.undoCount ? (
          <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-[#5566f6] px-1 text-[10px] font-semibold leading-4 text-white tabular-nums">
            {undo.undoCount}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={undo.onRedo}
        disabled={!undo.canRedo}
        aria-label={t("redoAria")}
        title={t("redoTitle")}
        className={UNDO_ICON_BUTTON_CLASS}
      >
        <Redo2 className="size-4" />
      </button>
    </div>
  );
}
