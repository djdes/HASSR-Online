"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * Ячейка «бумажной» таблицы журнала, в которой текст ПЕРЕНОСИТСЯ.
 *
 * Зачем (2026-09-07, жалоба владельца с телефона):
 * значения журналов лежали в однострочных `<input>` внутри колонок
 * фиксированной процентной ширины (`table-fixed` + `colgroup`). На
 * телефоне полотно таблицы 1000-1200px, колонка «Дата, время
 * фактической реализации» получалась ~90px — и «2026-09-09 18:00»,
 * «Соответствует», «+2 °C до +6 °C» просто обрезались. Видно было
 * «Не соответ», «+2°C до +6», «2026-09»: короткое значение и то не
 * помещалось, а чтобы дочитать длинное — приходилось долго скроллить
 * вбок.
 *
 * Решение: `<textarea>`, который сам подстраивает высоту под
 * содержимое. Текст уходит на вторую-третью строку внутри той же
 * колонки — ничего не обрезается, а горизонтальный скролл не растёт.
 *
 * Почему не `field-sizing: content` (одна строка CSS): Safari его до
 * сих пор не поддерживает, а основной сценарий жалобы — именно iPhone.
 *
 * Поведение сделано «как у input», чтобы замена в клиентах была
 * механической:
 *   • Enter не вставляет перенос, а завершает правку (blur → autosave);
 *     Shift+Enter даёт настоящий перенос строки, где он нужен;
 *   • высота стартует с одной строки (`h-7` прежнего инпута) и растёт;
 *   • собственного скролла нет — `overflow-hidden`.
 */
export const JOURNAL_CELL_INPUT_CLASS =
  "block w-full resize-none overflow-hidden rounded-md border-0 bg-transparent px-1.5 py-[5px] text-[12.5px] leading-[1.35] text-[#0b1024] shadow-none outline-none transition-[background-color,box-shadow] duration-150 placeholder:text-[#9b9fb3] focus-visible:bg-[#f5f6ff] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-60";

/** Минимальная высота = высота прежней однострочной ячейки (`h-7`). */
const MIN_HEIGHT_PX = 28;

export type JournalCellInputProps = Omit<
  React.ComponentProps<"textarea">,
  "rows"
> & {
  /** Разрешить настоящий перенос по Enter (примечания, описания). */
  multiline?: boolean;
  /**
   * id `<datalist>` с подсказками (изделия, сотрудники, оценки).
   *
   * `<textarea>` атрибут `list` не поддерживает. Раньше ячейка на время
   * правки подменялась настоящим `<input list>`, но на iPhone и iPad
   * подмена элемента теряла фокус: ячейка «не редактировалась». Теперь
   * подсказки читаются из того же `<datalist>` и показываются своим
   * списком под ячейкой; выбор подставляет значение через обычное
   * событие `input`, так что `onChange` клиента срабатывает как при вводе.
   */
  list?: string;
};

/** Сколько подсказок показывать под ячейкой. */
const SUGGESTION_LIMIT = 8;

function readDatalistOptions(listId: string): string[] {
  if (typeof document === "undefined") return [];
  const element = document.getElementById(listId);
  if (!element) return [];
  return Array.from(element.querySelectorAll("option"))
    .map((option) => option.value)
    .filter((option) => option.trim().length > 0);
}

export function JournalCellInput({
  className,
  value,
  multiline = false,
  onKeyDown,
  onFocus,
  onBlur,
  onInput,
  list,
  ...props
}: JournalCellInputProps) {
  const t = useTranslations("journalUi.cellInput");
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  // Подсказки справочника: открыты пока ячейка в фокусе.
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const [options, setOptions] = React.useState<string[]>([]);
  const [highlight, setHighlight] = React.useState(-1);

  const resize = React.useCallback(() => {
    const el = ref.current;
    // Скрытый элемент мерить нельзя: scrollHeight = 0, и высота
    // схлопнулась бы в одну строку насовсем.
    if (!el || el.clientWidth === 0) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(MIN_HEIGHT_PX, el.scrollHeight)}px`;
  }, []);

  // Высота пересчитывается при внешней смене value (копирование
  // вчерашнего дня, отмена, приход данных с сервера). Ввод покрыт
  // `onInput` — он же обслуживает неуправляемые ячейки (`defaultValue`),
  // у которых `value` не меняется вовсе.
  React.useLayoutEffect(resize, [resize, value]);

  // На телефоне таблица стартует СКРЫТОЙ за вкладкой «Карточки», и на
  // момент монтирования ячейка имеет нулевой размер. Без наблюдателя
  // строки оставались в одну строку — ровно та обрезка, от которой
  // избавляемся. ResizeObserver ловит и появление таблицы, и смену
  // ширины колонки (поворот экрана).
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth;
      // Изменилась только высота — это наша же правка, не реагируем,
      // иначе наблюдатель зациклится сам на себе.
      if (width === lastWidth) return;
      lastWidth = width;
      resize();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [resize]);

  const current = String(value ?? "");
  const query = current.trim().toLowerCase();
  // Точное совпадение с вариантом (в ячейке уже «Хорошо») — показываем все
  // варианты, иначе переключить значение на соседнее было бы нельзя.
  const exactMatch = query.length > 0 && options.some((option) => option.toLowerCase() === query);
  const suggestions =
    list && suggestOpen
      ? options
          .filter((option) => !query || exactMatch || option.toLowerCase().includes(query))
          .slice(0, SUGGESTION_LIMIT)
      : [];

  /** Подставляет подсказку как обычный ввод: клиент получает onChange. */
  const pick = React.useCallback(
    (option: string) => {
      const el = ref.current;
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(el, option);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      setSuggestOpen(false);
      setHighlight(-1);
      resize();
    },
    [resize],
  );

  const textarea = (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      spellCheck={false}
      // Якорь для мобильного правила в globals.css: в покое ячейка
      // держит размер бланка (12.5px), при правке вырастает до 16px,
      // чтобы iOS Safari не зумил страницу.
      data-journal-cell=""
      // На телефоне размер шрифта меняется по :focus (см. globals.css),
      // а вместе с ним и число строк — высоту пересчитываем на обоих
      // концах, иначе ячейка на время правки обрезает последнюю строку.
      onFocus={(event) => {
        onFocus?.(event);
        if (list) {
          setOptions(readDatalistOptions(list));
          setSuggestOpen(true);
          setHighlight(-1);
        }
        resize();
      }}
      onBlur={(event) => {
        onBlur?.(event);
        setSuggestOpen(false);
        setHighlight(-1);
        resize();
      }}
      onInput={(event) => {
        onInput?.(event);
        if (list && !suggestOpen) setSuggestOpen(true);
        setHighlight(-1);
        resize();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (suggestions.length > 0) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlight((index) => (index + 1) % suggestions.length);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setSuggestOpen(false);
            return;
          }
          if (event.key === "Enter" && highlight >= 0 && !event.shiftKey) {
            event.preventDefault();
            pick(suggestions[highlight]);
            return;
          }
        }
        if (event.key === "Enter" && !event.shiftKey && !multiline) {
          // Ячейка бланка ведёт себя как input: Enter = «записал».
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      className={cn(JOURNAL_CELL_INPUT_CLASS, className)}
      style={{ minHeight: MIN_HEIGHT_PX }}
      {...props}
    />
  );

  if (!list) return textarea;

  return (
    <span className="relative block">
      {textarea}
      {suggestions.length > 0 ? (
        <ul
          role="listbox"
          aria-label={t("suggestions")}
          className="absolute left-0 top-full z-30 mt-1 max-h-56 w-max min-w-full max-w-[320px] overflow-auto rounded-2xl border border-[#ececf4] bg-white p-1.5 text-left shadow-[0_24px_60px_-24px_rgba(11,16,36,0.35)] print:hidden"
        >
          {suggestions.map((option, index) => (
            <li
              key={option}
              role="option"
              aria-selected={index === highlight}
              // mousedown с preventDefault — ячейка не теряет фокус до выбора.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(option);
              }}
              className={cn(
                "cursor-pointer rounded-xl px-3 py-2 text-[13px] leading-snug text-[#0b1024] transition-colors duration-150 hover:bg-[#f5f6ff]",
                index === highlight && "bg-[#eef1ff] font-medium text-[#3848c7]",
              )}
            >
              {option}
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
