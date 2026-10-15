/**
 * Правка выделенных строк по очереди — чистая логика (client-safe, без
 * React), чтобы её можно было проверить тестами. Хук —
 * `use-sequential-edit.ts`, кнопка полосы выделения —
 * `selection-edit-button.tsx`.
 *
 * Очередь хранит id, а не индексы: сохранение может пересортировать
 * строки (приёмка, прослеживаемость), а удалённые в процессе строки
 * просто пропускаются.
 */
export type SequentialEditState = {
  /** Выделенные строки в порядке обхода. */
  ids: string[];
  /** Позиция открытой сейчас строки в `ids`. */
  index: number;
  /** Сколько строк уже сохранено. */
  done: number;
};

/**
 * Пытается открыть строки начиная с `from`; `open` возвращает `false`,
 * если строки больше нет (пропускаем). Возвращает индекс открытой строки
 * или -1, когда открывать нечего.
 */
export function openNextEditable(ids: readonly string[], from: number, open: (id: string) => boolean): number {
  for (let i = Math.max(0, from); i < ids.length; i += 1) {
    if (open(ids[i])) return i;
  }
  return -1;
}

/** Progress data for localized display; no label participates in queue behavior. */
export function sequentialEditProgress(state: SequentialEditState | null): { current: number; total: number } | null {
  if (!state || state.ids.length <= 1) return null;
  return { current: state.done + 1, total: state.ids.length };
}
