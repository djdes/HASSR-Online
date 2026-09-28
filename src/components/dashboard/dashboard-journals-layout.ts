/**
 * Раскладка списка «Обязательные журналы» на главной — общая для самого
 * списка (`DashboardJournalsGrid`, клиентский) и скелета загрузки
 * (`dashboard/loading.tsx`, серверный). Отдельный модуль без
 * "use client": из клиентского модуля серверу достались бы не строки, а
 * клиентские ссылки.
 */

/** Панель над списком: на телефоне кнопки и под ними поиск, с `lg` — одной строкой. */
export const JOURNAL_TOOLBAR_CLASS = "flex flex-col gap-3 lg:flex-row lg:items-center";

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
