/**
 * Единый стиль всплывающих панелей (Select / DropdownMenu / Popover /
 * breadcrumbs). Токены — из `.claude/skills/design-system`: панель
 * rounded-2xl с мягкой тенью, пункты с боковыми отступами и indigo-hover,
 * подписи групп — маленький uppercase. Раньше каждый примитив был
 * shadcn-дефолтом (rounded-md, bg-popover, серый hover, p-1), и списки
 * выглядели как голый текст без ориентиров.
 */

/** Панель любого всплывающего меню. */
export const MENU_PANEL_CLASS =
  "rounded-2xl border border-[#ececf4] bg-white text-[#0b1024] shadow-[0_24px_60px_-24px_rgba(11,16,36,0.35)]";

/** Внутренний отступ панели — «воздух» вокруг пунктов. */
export const MENU_PANEL_PADDING_CLASS = "p-1.5";

/**
 * Пункт меню / опция селекта.
 *
 * Подсветка при наведении и фокусе — через токен темы `--app-tint-indigo`,
 * а не хекс: хекс `#f5f6ff` в тёмной теме не
 * перекрашивался, и под курсором светлая плашка ложилась под светлый
 * текст — пункт становился невидимым (2026-09-25). Токены объявлены на
 * `:root`, поэтому работают и в порталах вне `.app-shell`.
 */
export const MENU_ITEM_CLASS =
  "relative flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 max-sm:min-h-[44px] text-[13.5px] leading-[1.25] text-[#0b1024] outline-hidden select-none transition-colors duration-150 focus:bg-[var(--app-tint-indigo)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 data-[highlighted]:bg-[var(--app-tint-indigo)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-[#9b9fb3]";

/** Выбранный / текущий пункт. */
export const MENU_ITEM_ACTIVE_CLASS = "bg-[#eef1ff] font-medium text-[#3848c7]";

/** Приглушённый пункт «сбросить выбор» (`__empty__`) — не подсвечиваем как выбор. */
export const MENU_ITEM_MUTED_CLASS =
  "text-[#9b9fb3] data-[state=checked]:bg-transparent data-[state=checked]:font-normal data-[state=checked]:text-[#9b9fb3]";

/** Подпись группы — маленький uppercase с иконкой слева. */
export const MENU_LABEL_CLASS =
  "flex items-center gap-1.5 px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3] [&_svg]:size-3 [&_svg]:shrink-0";

export const MENU_SEPARATOR_CLASS =
  "pointer-events-none -mx-1.5 my-1.5 h-px bg-[#ececf4]";

/** Цвет галочки / индикатора выбранного пункта. */
export const MENU_INDICATOR_CLASS = "text-[#3848c7]";

/** Анимация раскрытия — общая для всех примитивов, 150 мс. */
export const MENU_MOTION_CLASS =
  "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 duration-150";
