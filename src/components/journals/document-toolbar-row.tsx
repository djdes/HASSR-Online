"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Ряд шапки документа над таблицей: описание журнала слева, кнопки
 * («Добавить строку» и соседние) справа — в одну строку, где помещается
 * (от 640px). На узком телефоне описание сверху, кнопки под ним во всю
 * ширину экрана.
 *
 * Правка владельца 2026-09-28 (iPhone, бланк температуры и влажности
 * складов): описание и «Добавить строку» стояли столбиком у левого края
 * широкого листа, и стоило листу сдвинуться вбок, оба уезжали за край, а
 * справа оставалось пустое место — «тут в строчку должно быть». Ряд —
 * часть шапки страницы, а не листа: всегда по ширине экрана и от левого
 * края, в рамку прокрутки таблицы его не кладут.
 *
 * Лента во всю ширину раздела (`-mx-4 md:-mx-8` гасят поля страницы, как
 * у полосы автозаполнения) с линией снизу — как у прежнего
 * `StickyActionBar`, который этот ряд заменил.
 *
 * `sticky` — на экране от 640px ряд прилипает под шапкой сайта (55/72px
 * + линия) при прокрутке длинной сетки. На телефоне ряд обычный:
 * описание в несколько строк и кнопка во всю ширину заняли бы пятую
 * часть экрана на всё время прокрутки.
 *
 * Печать: описание остаётся (мелким кеглем по центру, как в бланке),
 * кнопки и экранная лента — нет.
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
  if (!description && !children) return null;
  return (
    <div
      data-doc-toolbar-row
      className={cn(
        "-mx-4 mb-6 flex flex-col gap-3 border-b border-[#dcdfed] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 md:-mx-8 md:px-8",
        sticky && "sm:sticky sm:top-[73px] sm:z-20 sm:bg-white/95 sm:backdrop-blur",
        "print:static print:mx-0 print:mb-0 print:block print:border-0 print:bg-transparent print:p-0 print:backdrop-blur-none",
        className
      )}
    >
      {description ? (
        <p className="min-w-0 text-[13px] leading-snug text-[#6f7282] sm:flex-1 print:mt-1 print:text-center print:text-[10px]">
          {description}
        </p>
      ) : null}
      {children ? (
        <div className="flex flex-col gap-2 max-sm:[&>*]:w-full sm:shrink-0 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3 print:hidden">
          {children}
        </div>
      ) : null}
    </div>
  );
}
