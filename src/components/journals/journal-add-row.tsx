"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { GRID_CELL_CLASS } from "@/components/journals/journal-grid";

/**
 * Последняя строка таблицы журнала — пустая строка, по которой
 * добавляют запись.
 *
 * Зачем: в бланке снизу оставляли несколько пустых строк-заготовок,
 * как на бумаге. На экране они ничего не значили — нажать на них было
 * нельзя, — а человек видел журнал с шестью пустыми строками и не
 * понимал, откуда там берутся люди. Пустая строка теперь ровно одна и
 * она кликабельная: открывает то же окно, что и «Добавить» сверху.
 *
 * Строка настоящая, с ячейками по сетке журнала: у неё те же рамки и
 * те же колонки, что у строк с данными. Так видно, что запись встанет
 * именно сюда. Сплошная полоса на всю ширину читалась как ещё одна
 * панель инструментов, а не как строка бланка.
 *
 * Колонки дат остаются пустыми: заполнять их нечем, пока нет самой
 * записи (сотрудника, помещения, оборудования).
 *
 * На печать не идёт — на бумаге пустые строки задаются настройкой
 * «Добавлять пустых строк при печати».
 */
export function JournalAddRow({
  label,
  onClick,
  disabled = false,
  /** Пустых ячеек слева от подписи — обычно колонка с галочкой. */
  leading = 0,
  /** На сколько колонок растянута подпись. */
  labelSpan = 2,
  /** Пустых ячеек справа: даты, метрики и прочие колонки записи. */
  trailing = 0,
  /**
   * Ширина таблицы в колонках. Из неё считается число пустых ячеек
   * справа, если они не заданы через `trailing`.
   */
  colSpan,
  /** Класс ячеек — по умолчанию рамка журнальной сетки. */
  cellClassName = GRID_CELL_CLASS,
}: {
  label?: string;
  onClick: () => void;
  disabled?: boolean;
  leading?: number;
  labelSpan?: number;
  trailing?: number;
  colSpan?: number;
  cellClassName?: string;
}) {
  const t = useTranslations("journalUi.addRow");
  const resolvedLabel = label ?? t("label");
  const trailingCount =
    trailing > 0
      ? trailing
      : colSpan
        ? Math.max(0, colSpan - leading - labelSpan)
        : 0;

  return (
    <tr
      data-journal-add-row
      // Нажатие ловит вся строка — так задумано. Роль строки при этом не
      // подменяем: таблица должна остаться таблицей для скринридера, а
      // настоящая кнопка живёт в ячейке с подписью, ей и достаётся фокус.
      onClick={disabled ? undefined : onClick}
      className={`group/add-row print:hidden ${
        disabled ? "opacity-50" : "cursor-pointer transition-colors duration-150 hover:bg-[#f5f6ff]"
      }`}
    >
      {/* Маркеры колонок нужны компактной сетке на узком экране
          (globals.css, `[data-journal-grid]`): без них ширину столбца
          названия задавала бы эта строка, а закрепление левой колонки
          теряло бы её при прокрутке. Вне такой сетки атрибуты ничего не
          значат. */}
      {Array.from({ length: leading }).map((_, index) => (
        <td key={`lead-${index}`} className={`${cellClassName} px-2 py-0.5`} data-grid-check />
      ))}

      <td
        colSpan={labelSpan}
        className={`${cellClassName} p-0 text-left align-middle leading-tight`}
        data-grid-label
      >
        <button
          type="button"
          disabled={disabled}
          onClick={(event) => {
            // Клик по кнопке не должен сработать дважды: строка выше
            // слушает то же событие.
            event.stopPropagation();
            onClick();
          }}
          className="flex w-full items-center gap-2 px-2 py-2 text-left text-[13.5px] font-medium text-[#6f7282] transition-colors duration-150 group-hover/add-row:text-[#3848c7] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#5566f6]/15 disabled:pointer-events-none"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-[#eef1ff] text-[#5566f6]">
            <Plus className="size-4" strokeWidth={2.5} />
          </span>
          {resolvedLabel}
        </button>
      </td>

      {/* Правые колонки — поштучно, а не одной широкой ячейкой: иначе
          вертикальные линии сетки обрываются и строка перестаёт читаться
          как строка бланка. */}
      {Array.from({ length: trailingCount }).map((_, index) => (
        <td key={`trail-${index}`} className={`${cellClassName} px-2 py-0.5`} />
      ))}
    </tr>
  );
}
