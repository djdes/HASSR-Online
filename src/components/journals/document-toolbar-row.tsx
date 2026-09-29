"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Ряд шапки документа над таблицей: описание журнала слева, кнопки
 * («Добавить строку» и соседние) справа — в одну строку на любой ширине.
 *
 * Правка владельца 2026-09-28 (iPhone, журнал температуры и влажности
 * складов): описание и «Добавить строку» стояли столбиком у левого края
 * широкого листа, и стоило листу сдвинуться вбок, оба уезжали за край, а
 * справа оставалось пустое место — «тут в строчку должно быть». Ряд —
 * часть шапки страницы, а не листа: всегда по ширине экрана и от левого
 * края, в рамку прокрутки таблицы его не кладут.
 *
 * Правка владельца 2026-09-29: и на узком телефоне описание и кнопка —
 * в одну строку (раньше до 640px кнопка стояла под описанием во всю
 * ширину). До 640px описание обрезано до трёх строк, под ним ссылка
 * «Подробнее» / «Свернуть» — она есть, только если текст правда не
 * поместился (scrollHeight против clientHeight, пересчёт при изменении
 * размера). Справа компактная кнопка `DocumentToolbarAddButton`: «+» и
 * «Добавить», не сжимается, прижата к верху ряда. Описание на телефоне —
 * 13px (`data-touch-compact`: общее правило «крупнее на телефоне» подняло
 * бы его до 15px, и в три строки влезало бы заметно меньше). От 640px —
 * как раньше: описание целиком и «Добавить строку». Нет кнопок (документ
 * закрыт) — одно описание на всю ширину.
 *
 * Лента во всю ширину раздела (`-mx-4 md:-mx-8` гасят поля страницы, как
 * у полосы автозаполнения) с линией снизу — как у прежнего
 * `StickyActionBar`, который этот ряд заменил.
 *
 * `sticky` — на экране от 640px ряд прилипает под шапкой сайта (55/72px
 * + линия) при прокрутке длинной сетки. На телефоне ряд обычный: даже
 * три строки описания с кнопкой занимали бы заметную часть экрана на всё
 * время прокрутки.
 *
 * Печать: описание остаётся целиком (мелким кеглем по центру, как в
 * журнале), кнопки, «Подробнее» и экранная лента — нет.
 */
export function DocumentToolbarRow({
  description,
  children,
  sticky = false,
  className,
}: {
  /** Описание журнала: область применения, периодичность. */
  description?: ReactNode;
  /** Кнопки. Нет кнопок (документ закрыт) — остаётся одно описание. */
  children?: ReactNode;
  /** Прилипать под шапкой сайта на экране от 640px. */
  sticky?: boolean;
  className?: string;
}) {
  const descriptionId = useId();
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);

  // Обрезан ли текст тремя строками. Меряем только в свёрнутом виде:
  // развёрнутый текст не обрезан по определению, а «Свернуть» при этом
  // должна остаться. От 640px обрезки нет — и ссылки тоже.
  useEffect(() => {
    const element = descriptionRef.current;
    if (!element || expanded) return;
    const measure = () => setClipped(element.scrollHeight - element.clientHeight > 1);
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [expanded, description]);

  if (!description && !children) return null;
  return (
    <div
      data-doc-toolbar-row
      className={cn(
        "-mx-4 mb-6 flex items-start gap-3 border-b border-[#dcdfed] bg-white px-4 py-3 sm:items-center sm:justify-between sm:gap-6 md:-mx-8 md:px-8",
        sticky && "sm:sticky sm:top-[73px] sm:z-20 sm:bg-white/95 sm:backdrop-blur",
        "print:static print:mx-0 print:mb-0 print:block print:border-0 print:bg-transparent print:p-0 print:backdrop-blur-none",
        className
      )}
    >
      {description ? (
        <div data-touch-compact="" className="min-w-0 flex-1">
          <p
            id={descriptionId}
            ref={descriptionRef}
            data-doc-toolbar-description
            className={cn(
              "text-[13px] leading-snug text-[#6f7282] print:mt-1 print:line-clamp-none print:text-center print:text-[10px]",
              !expanded && "max-sm:line-clamp-3"
            )}
          >
            {description}
          </p>
          {expanded || clipped ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={descriptionId}
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 py-0.5 text-[13px] font-medium leading-snug text-[#5566f6] hover:underline sm:hidden print:hidden"
            >
              {expanded ? "Свернуть" : "Подробнее"}
            </button>
          ) : null}
        </div>
      ) : null}
      {children ? (
        <div
          data-doc-toolbar-actions
          className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3 print:hidden"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * «Добавить строку» для ряда шапки. До 640px — компактная: «+» и
 * «Добавить» (полная подпись — в `aria-label`), от 640px — «Добавить
 * строку» целиком. Не сжимается (`shrink-0` у `Button`), высота 44px — на
 * телефоне правило «крупнее на телефоне» поднимает её до 48px.
 */
export function DocumentToolbarAddButton({
  label = "Добавить строку",
  shortLabel = "Добавить",
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "children"> & {
  /** Подпись от 640px. */
  label?: string;
  /** Подпись на узком телефоне. */
  shortLabel?: string;
}) {
  return (
    <Button
      type="button"
      aria-label={label}
      data-doc-toolbar-add
      className={cn(
        "h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white hover:bg-[#4a5bf0] max-sm:gap-1.5",
        className
      )}
      {...props}
    >
      <Plus className="size-5" strokeWidth={2.5} />
      <span className="sm:hidden">{shortLabel}</span>
      <span className="max-sm:hidden">{label}</span>
    </Button>
  );
}
