"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  openNextEditable,
  sequentialEditProgress,
  sequentialEditSummary,
  type SequentialEditState,
} from "@/components/journals/sequential-edit";

/**
 * Правка выделенных строк по очереди тем же окном, что и создание.
 *
 * Подключение в клиенте журнала:
 *   const seq = useSequentialEdit({
 *     open: (id) => { const row = rows.find(r => r.id === id); if (!row) return false; openEditRow(row); return true; },
 *     close: () => { setEditingRowId(null); setModalOpen(false); },
 *   });
 *   • кнопка полосы выделения → `seq.start(selectedIds)`;
 *   • после сохранения строки в режиме правки → `seq.saved()` (откроет
 *     следующую или закроет окно);
 *   • закрытие окна без сохранения → `seq.cancelled()`;
 *   • заголовок окна → `seq.progress` («(2 из 5)»).
 * Когда очередь не активна, `saved()`/`cancelled()` просто закрывают окно —
 * обработчики журнала не ветвятся.
 */
export function useSequentialEdit(handlers: { open: (id: string) => boolean; close: () => void }) {
  // Обработчики журнала пересоздаются каждый рендер (замыкают config) —
  // держим их в ref, чтобы очередь всегда звала актуальные.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const stateRef = useRef<SequentialEditState | null>(null);
  const [state, setStateRaw] = useState<SequentialEditState | null>(null);
  const setState = useCallback((next: SequentialEditState | null) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  const finish = useCallback(
    (done: number) => {
      const current = stateRef.current;
      setState(null);
      handlersRef.current.close();
      if (current && current.ids.length > 1) toast.success(sequentialEditSummary(done, current.ids.length));
    },
    [setState]
  );

  const start = useCallback(
    (ids: readonly string[]) => {
      const list = Array.from(new Set(ids));
      const index = openNextEditable(list, 0, handlersRef.current.open);
      if (index === -1) {
        toast.error("Выбранные строки не найдены");
        return;
      }
      setState({ ids: list, index, done: 0 });
    },
    [setState]
  );

  const saved = useCallback(() => {
    const current = stateRef.current;
    if (!current) {
      handlersRef.current.close();
      return;
    }
    const done = current.done + 1;
    const index = openNextEditable(current.ids, current.index + 1, handlersRef.current.open);
    if (index === -1) {
      finish(done);
      return;
    }
    setState({ ...current, index, done });
  }, [finish, setState]);

  const cancelled = useCallback(() => {
    const current = stateRef.current;
    if (!current) {
      handlersRef.current.close();
      return;
    }
    finish(current.done);
  }, [finish]);

  return useMemo(
    () => ({
      active: state !== null,
      progress: sequentialEditProgress(state),
      start,
      saved,
      cancelled,
    }),
    [state, start, saved, cancelled]
  );
}
