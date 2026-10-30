"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ScrollArea } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * Длинный список с видимой полосой прокрутки справа (владелец, 2026-10-30:
 * «если точек много, список ограничивается и добавляется скролл справа»).
 * Системная полоса на iPhone и в macOS прячется, пока список не листают, —
 * здесь своя (Radix ScrollArea): видна, пока список не помещается, и её
 * можно тянуть мышью или пальцем. Пока всё помещается — полосы нет.
 *
 * Высоту ограничивает `maxHeightClassName`. Выбранный пункт
 * (`data-active-option`) при открытии прокручен в середину видимой части.
 * `data-vaul-no-drag` на полосе: в листе снизу (vaul) перетаскивание
 * ползунка иначе тянуло бы весь лист вниз.
 */
export function ScrollList({
  maxHeightClassName,
  className,
  children,
}: {
  maxHeightClassName: string;
  className?: string;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = viewport.current;
    const active = element?.querySelector<HTMLElement>("[data-active-option]");
    if (!element || !active) return;
    element.scrollTop = Math.max(0, active.offsetTop - (element.clientHeight - active.offsetHeight) / 2);
  }, []);

  return (
    <ScrollArea.Root type="auto" className={cn("relative overflow-hidden", className)}>
      {/* Radix оборачивает содержимое в `display: table` — тогда строка растёт по
          длинному названию, и `truncate` не срабатывает: название уезжало под
          полосу вместе с галочкой. `block!` возвращает обрезку многоточием. */}
      <ScrollArea.Viewport
        ref={viewport}
        className={cn("relative w-full overscroll-contain pr-3 [&>div]:block!", maxHeightClassName)}
      >
        {children}
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar
        orientation="vertical"
        data-scroll-list-bar
        data-vaul-no-drag
        className="flex w-3 touch-none select-none rounded-full bg-[#5566f6]/[0.06] p-[3px]"
      >
        <ScrollArea.Thumb className="relative flex-1 rounded-full bg-[#5566f6]/40 transition-colors duration-150 hover:bg-[#5566f6]/60" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}
