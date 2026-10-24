"use client";

import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

/**
 * Отмена только что сделанной отметки.
 *
 * Обязательна везде, где значение ставится одним движением — свайпом
 * или массовой кнопкой. Журнал это доказательство на проверке, и
 * действие, которое нельзя забрать назад, люди просто боятся делать:
 * массовое «отметить всех» до сих пор существовало, но им не
 * пользовались именно поэтому.
 *
 * Тост, а не кнопки в шапке: кнопки далеко от пальца и не говорят, ЧТО
 * откатится. Тост появляется на месте действия и называет его.
 *
 * Семь секунд — столько человек смотрит на экран после нажатия. Меньше
 * не успеть прочитать, больше — тост мешает следующей строке.
 */
const UNDO_MS = 7000;

export type UndoableAction = {
  /** Что человек увидит: «Денис Волков — Зд.», «Отмечено 8». */
  label: string;
  /** Вернуть как было. Должно быть безопасно вызвать один раз. */
  onUndo: () => void | Promise<void>;
};

export function useJournalUndo() {
  const t = useTranslations("journalUi.undo");
  // Идентификатор последнего тоста: новое действие гасит предыдущее,
  // иначе после десяти свайпов подряд экран зарастает тостами.
  const lastToast = useRef<string | number | null>(null);

  return useCallback((action: UndoableAction) => {
    if (lastToast.current !== null) toast.dismiss(lastToast.current);

    lastToast.current = toast.success(action.label, {
      duration: UNDO_MS,
      action: {
        label: t("action"),
        onClick: () => {
          void Promise.resolve(action.onUndo()).catch(() => {
            toast.error(t("failed"));
          });
        },
      },
    });
  }, [t]);
}
