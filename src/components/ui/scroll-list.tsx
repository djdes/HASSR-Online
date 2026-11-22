"use client";

import { useEffect, useRef, type ReactNode, type Ref } from "react";
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
      <VisibleScrollbar />
    </ScrollArea.Root>
  );
}

/** Полоса прокрутки — одна на списки и меню: видна, пока содержимое не помещается. */
function VisibleScrollbar({ className }: { className?: string }) {
  return (
    <ScrollArea.Scrollbar
      orientation="vertical"
      data-scroll-list-bar
      data-vaul-no-drag
      className={cn("flex w-3 touch-none select-none rounded-full bg-[#5566f6]/[0.06] p-[3px]", className)}
    >
      <ScrollArea.Thumb className="relative flex-1 rounded-full bg-[#5566f6]/40 transition-colors duration-150 hover:bg-[#5566f6]/60" />
    </ScrollArea.Scrollbar>
  );
}

/**
 * Прокрутка во всю оставшуюся высоту колонки — для меню (владелец,
 * 2026-11-22: «меню слева — всегда видимый скролл при раскрытии»): лист меню
 * на телефоне и сайдбар компьютера. Полоса справа видна, пока меню длиннее
 * своей коробки (`type="auto"`), не прячется до прокрутки, как системная на
 * iPhone и в macOS. Содержимое — колонка во всю высоту: `mt-auto` прижимает
 * последний блок к низу, `sticky bottom-0` держит его на виду.
 */
export function ScrollPane({
  className,
  viewportClassName,
  viewportRef,
  children,
}: {
  className?: string;
  viewportClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <ScrollArea.Root type="auto" className={cn("relative flex min-h-0 flex-1 flex-col overflow-hidden", className)} data-scroll-pane>
      <ScrollArea.Viewport
        ref={viewportRef}
        className={cn(
          "min-h-0 w-full flex-1 overscroll-contain [&>div]:flex! [&>div]:min-h-full [&>div]:flex-col",
          viewportClassName,
        )}
      >
        {children}
      </ScrollArea.Viewport>
      <VisibleScrollbar className="my-1 mr-0.5 w-2.5 p-[2px]" />
    </ScrollArea.Root>
  );
}
