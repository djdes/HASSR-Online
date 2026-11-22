/**
 * «Пришла проверка» в меню — экстренное действие, а не пункт списка
 * (владелец, 2026-11-22: «сейчас он как будто нажат, активен — продумай
 * индикацию»). Серой заливки в покое больше нет: строка обведена тонкой
 * линией тона предупреждения, щит — того же тона. Человек внутри раздела —
 * строка залита мягким тоном предупреждения (`aria-current`). Цвета — токены
 * `--app-warn-*`: у них есть значения и в тёмной теме, и в «Новой».
 * Закреплена внизу меню (`sticky bottom-0`) и на телефоне, и на компьютере.
 */

/** Строка в покое: прозрачная, тонкая линия тона предупреждения. */
export const INSPECTION_IDLE =
  "border border-[color-mix(in_srgb,var(--app-warn-fg)_24%,transparent)] bg-transparent text-[var(--app-text,#0b1024)] hover:border-[color-mix(in_srgb,var(--app-warn-fg)_40%,transparent)] hover:bg-[var(--app-warn-bg)]";

/** Человек в разделе «Пришла проверка». */
export const INSPECTION_ACTIVE =
  "border border-[color-mix(in_srgb,var(--app-warn-fg)_40%,transparent)] bg-[var(--app-warn-bg)] text-[var(--app-warn-fg)]";

/** Щит — тоном предупреждения в обоих состояниях. */
export const INSPECTION_ICON = "text-[var(--app-warn-fg)]";

/**
 * Обёртка закреплённой строки: прилипает и к низу, и к верху прокрутки —
 * над длинным меню она внизу, а когда человек листает её собственный список,
 * остаётся сверху; на виду всегда. Под ней фон листа или карточки меню,
 * сверху мягкое затухание — пункты уходят под строку, а не обрываются.
 */
export const INSPECTION_DOCK =
  "sticky top-0 bottom-0 z-10 bg-[var(--app-surface,#fff)] before:pointer-events-none before:absolute before:inset-x-0 before:-top-4 before:h-4 before:bg-gradient-to-t before:from-[var(--app-surface,#fff)] before:to-transparent";
