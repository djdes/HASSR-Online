/**
 * Раскладка списка «Обязательные журналы» на главной — общая для самого
 * списка (`DashboardJournalsGrid`, клиентский) и скелета загрузки
 * (`dashboard/loading.tsx`, серверный). Отдельный модуль без
 * "use client": из клиентского модуля серверу достались бы не строки, а
 * клиентские ссылки.
 */

/**
 * Панель над списком: поиск и кнопки одной строкой, если помещаются (на
 * телефоне — поиск и «QR-коды»), иначе кнопки переносятся под поиск; с `lg`
 * — всегда одной строкой (07.11.2026: на телефоне кнопка и поиск в два ряда
 * отодвигали журналы на 60px вниз).
 */
export const JOURNAL_TOOLBAR_CLASS = "flex flex-wrap items-center gap-3 lg:flex-row lg:flex-nowrap";

/** Сетка строк: 1 колонка на телефоне, 2 с `md`, 3 с `lg`. */
export const JOURNAL_LIST_CLASS = "grid grid-cols-1 gap-x-8 md:grid-cols-2 lg:grid-cols-3";

/** Тонкая линия над каждой строкой — одна система разделителей. */
export const JOURNAL_ITEM_CLASS = "min-w-0 border-t border-[#ececf4]";

/** Строка: превью, название, отметка/стрелка. */
export const JOURNAL_ROW_CLASS = "flex min-w-0 items-center gap-3.5 py-3";

/** Размер превью бланка, 4:3: 64×48 на телефоне, 80×60 с `lg`. */
export const JOURNAL_THUMB_SIZE_CLASS = "h-12 w-16 lg:h-[60px] lg:w-20";

/** Рамка превью: белый «лист» с тонкой линией и мягким углом. */
export const JOURNAL_THUMB_BOX_CLASS = `relative block ${JOURNAL_THUMB_SIZE_CLASS} overflow-hidden rounded-[8px] border border-[#ececf4] bg-white`;

/**
 * «Сначала то, что осталось» (07.11.2026): на «Сегодня» незаполненные
 * журналы сверху, заполненные — отдельной группой ниже. Порядок внутри
 * групп сохраняется (по алфавиту — его задаёт вызывающий). Один список, как
 * раньше, когда группа одна (всё заполнено или ничего) и при поиске —
 * там важнее найти, чем разложить.
 */
export function splitTodayJournals<T extends { filled: boolean }>(
  items: readonly T[],
  { searching }: { searching: boolean },
): { todo: T[]; done: T[] } {
  const todo = items.filter((item) => !item.filled);
  const done = items.filter((item) => item.filled);
  if (searching || todo.length === 0 || done.length === 0) return { todo: [...items], done: [] };
  return { todo, done };
}
