"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToneChip } from "@/components/layout/nav-icons";

/**
 * Блок «Мы на связи» на главной. На телефоне (владелец, 2026-11-21: «чтобы
 * помещалось на 1 страницу с контактами снизу, если что блок контакты под
 * спойлер убрать») он свёрнут в одну строку: нажал — раскрылись те же вкладки
 * и каналы. С 768px контакты всегда открыты, как раньше, и строки-кнопки нет.
 */
export function HomeContactsSpoiler({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <aside
      className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-4"
      data-home-contacts
      data-open={open ? "" : undefined}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-[56px] w-full items-center gap-3 rounded-3xl px-4 py-2.5 text-left transition-colors duration-150 hover:bg-[#fafbff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 md:hidden"
        data-home-contacts-toggle
      >
        <ToneChip tone="sky" icon={MessageCircle} className="size-9 rounded-xl" iconClassName="size-4" />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[#0b1024]">{title}</span>
        <ChevronDown
          className={cn("size-5 shrink-0 text-[#9b9fb3] transition-transform duration-200", open && "rotate-180")}
          aria-hidden
        />
      </button>
      <div className="mb-2.5 hidden px-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282] md:block">
        {title}
      </div>
      <div id={panelId} className={cn(open ? "block px-4 pb-4" : "hidden", "md:block md:p-0")} data-home-contacts-panel>
        {children}
      </div>
    </aside>
  );
}
