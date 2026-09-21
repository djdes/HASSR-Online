"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, Check, MapPin } from "lucide-react";

/**
 * Быстрая смена объекта на QR-странице замера: ответственный обходит
 * склады/холодильники по кругу — после сохранения одного сразу
 * переходит к следующему, не сканируя новый плакат. Имя сотрудника
 * помнится в браузере (общий ключ QR-страниц), значения уже снятых
 * объектов видны в списке.
 */
export type QuickSwitchItem = {
  id: string;
  name: string;
  sublabel?: string | null;
  href: string;
  filled: boolean;
  /** «22 °C · 45 %» — что уже записано сегодня. */
  summary?: string | null;
  /** Те же показания числами — чтобы подставить в форму текущего объекта. */
  values?: { temperature?: number | null; humidity?: number | null } | null;
  current: boolean;
};

export function nextQuickSwitchItem(items: QuickSwitchItem[]): QuickSwitchItem | null {
  const index = items.findIndex((item) => item.current);
  const order = index >= 0 ? [...items.slice(index + 1), ...items.slice(0, index)] : items;
  return order.find((item) => !item.filled) ?? null;
}

/** Компактная строка сверху формы: где вы, что уже снято, куда дальше. */
export function QuickSwitchStrip({ items, title }: { items: QuickSwitchItem[]; title: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  // Текущий объект — в центр полосы, чтобы соседи были видны с обеих сторон (без вертикального скролла страницы).
  useEffect(() => {
    const box = scroller.current;
    const current = box?.querySelector<HTMLElement>("[aria-current]");
    if (!box || !current) return;
    box.scrollLeft = Math.max(0, current.offsetLeft - (box.clientWidth - current.offsetWidth) / 2);
  }, [items]);
  if (items.length < 2) return null;
  const filled = items.filter((item) => item.filled).length;
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-3.5 text-[#5566f6]" />
          {title}
        </span>
        <span className="tabular-nums normal-case tracking-normal text-[#9b9fb3]">
          снято {filled} из {items.length}
        </span>
      </div>
      <div ref={scroller} className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) =>
          item.current ? (
            <span
              key={item.id}
              aria-current="true"
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-[#5566f6] bg-[#5566f6] px-4 text-[15px] font-medium text-white"
            >
              {item.name}
            </span>
          ) : (
            <a
              key={item.id}
              href={item.href}
              className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[15px] font-medium transition-colors duration-150 ${
                item.filled
                  ? "border-[#d4f5e3] bg-[#f3fdf7] text-[#116b2a]"
                  : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              }`}
            >
              {item.filled ? <Check className="size-3.5" /> : null}
              {item.name}
              {item.summary ? <span className="text-[12px] font-normal opacity-80">{item.summary}</span> : null}
            </a>
          )
        )}
      </div>
    </div>
  );
}

/** После сохранения: кнопка «Дальше: следующий» и список всех объектов со статусом. */
export function QuickSwitchNext({ items, title }: { items: QuickSwitchItem[]; title: string }) {
  if (items.length < 2) return null;
  const next = nextQuickSwitchItem(items);
  const filled = items.filter((item) => item.filled).length;
  return (
    <div className="mt-6 text-left">
      {next ? (
        <a
          href={next.href}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[16px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]"
        >
          Дальше: {next.name}
          <ArrowRight className="size-5" />
        </a>
      ) : (
        <p className="rounded-2xl border border-[#d4f5e3] bg-[#f3fdf7] p-3 text-center text-[14px] font-medium text-[#116b2a]">
          Все объекты на этот срок сняты ✓
        </p>
      )}
      <div className="mt-4 mb-2 flex items-center justify-between text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
        <span>{title}</span>
        <span className="tabular-nums normal-case tracking-normal text-[#9b9fb3]">
          снято {filled} из {items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <a
            key={item.id}
            href={item.href}
            aria-current={item.current ? "true" : undefined}
            className={`flex min-h-[52px] items-center justify-between gap-3 rounded-2xl border px-4 py-2 text-[14px] font-medium transition-colors duration-150 ${
              item.filled
                ? "border-[#d4f5e3] bg-[#f3fdf7] text-[#116b2a]"
                : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            }`}
          >
            <span className="min-w-0">
              <span className="block truncate">{item.name}</span>
              {item.sublabel ? <span className="block text-[12px] font-normal text-[#6f7282]">{item.sublabel}</span> : null}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] font-normal">
              {item.filled ? (
                <>
                  {item.summary ?? "снято"}
                  <Check className="size-4" />
                </>
              ) : (
                <ArrowRight className="size-4 text-[#9b9fb3]" />
              )}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
