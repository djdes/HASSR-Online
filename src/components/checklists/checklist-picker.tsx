"use client";

import { useState, type ReactNode } from "react";
import { AlertCircle, Check, ChevronDown, Search, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { initials } from "@/components/checklists/checklist-page-ui";

export type PickerTone = "recommended" | "ok" | "not-recommended" | "plain";

export type PickerItem = {
  id: string;
  label: string;
  /** Вторая строка: должность, «точка» и т. п. */
  sub?: string;
  /** Справа: «3 чел.», «нет Telegram». */
  hint?: string;
  hintTone?: "muted" | "warn";
  /** Иконка вместо инициалов (точки, должности). */
  icon?: ReactNode;
};

export type PickerGroup = { key: string; title: string; tone: PickerTone; icon?: ReactNode; items: PickerItem[] };

const GROUP_TONE: Record<PickerTone, string> = {
  recommended: "bg-emerald-50/70 text-emerald-700",
  ok: "bg-[#fafbff] text-[#3c4053]",
  "not-recommended": "bg-[#fff8eb]/60 text-[#a16d32]",
  plain: "bg-[#fafbff] text-[#6f7282]",
};

/**
 * Групповой выбор в поповере — в стиле `UserPicker` со страницы
 * ответственных: группы «Рекомендуем / Можно / Не рекомендуем» (или
 * «Точки / Должности / Сотрудники»), поиск, аватар, подсказка справа.
 * Нативный `<select>` для людей не используем (CLAUDE.md, UX-правило 6).
 */
export function ChecklistPicker({
  value,
  groups,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  noneLabel,
  testId,
}: {
  value: string | null;
  groups: PickerGroup[];
  onChange: (id: string | null) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  /** Пункт «без выбора» вверху списка (например, «Без проверяющего»). */
  noneLabel?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const all = groups.flatMap((group) => group.items.map((item) => ({ item, group })));
  const selected = value ? all.find((entry) => entry.item.id === value) ?? null : null;
  const q = query.trim().toLowerCase();
  const filtered = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !q || item.label.toLowerCase().includes(q) || (item.sub ?? "").toLowerCase().includes(q)),
    }))
    .filter((group) => group.items.length > 0);

  function pick(id: string | null) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-picker={testId}
          className={cn(
            "flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl border bg-white px-3 py-2 text-left text-[14px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
            open ? "border-[#5566f6]" : "border-[#dcdfed] hover:border-[#5566f6]/50",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected ? (
              <>
                <Avatar item={selected.item} />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[#0b1024]">{selected.item.label}</span>
                  {selected.item.sub ? <span className="block truncate text-[12px] text-[#6f7282]">{selected.item.sub}</span> : null}
                </span>
              </>
            ) : (
              <span className="truncate text-[#9b9fb3]">{value === null && noneLabel ? noneLabel : placeholder}</span>
            )}
          </span>
          <ChevronDown className={cn("size-4 shrink-0 transition-transform duration-150", open ? "rotate-180 text-[#5566f6]" : "text-[#9b9fb3]")} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[260px] max-w-[calc(100vw-32px)] p-0">
        <div className="border-b border-[#ececf4] bg-[#fafbff] p-2">
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 size-3.5 text-[#9b9fb3]" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white pl-8 pr-3 text-[13px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
        </div>
        <div className="max-h-[320px] overflow-y-auto py-1">
          {noneLabel ? (
            <button
              type="button"
              onClick={() => pick(null)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors duration-150",
                value === null ? "bg-[#eef1ff] text-[#3848c7]" : "text-[#6f7282] hover:bg-[#f5f6ff]",
              )}
            >
              {noneLabel}
            </button>
          ) : null}
          {filtered.length === 0 ? <div className="px-3 py-4 text-center text-[13px] text-[#9b9fb3]">{emptyText}</div> : null}
          {filtered.map((group) => (
            <div key={group.key} className="py-0.5">
              <div className={cn("flex items-center gap-1.5 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em]", GROUP_TONE[group.tone])}>
                {group.icon ?? (group.tone === "recommended" ? <Sparkles className="size-3" /> : group.tone === "not-recommended" ? <AlertCircle className="size-3" /> : null)}
                {group.title}
                <span className="font-normal opacity-70">· {group.items.length}</span>
              </div>
              {group.items.map((item) => {
                const isSelected = item.id === value;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-picker-item={item.id}
                    onClick={() => pick(item.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors duration-150",
                      isSelected ? "bg-[#eef1ff] text-[#3848c7]" : "text-[#0b1024] hover:bg-[#f5f6ff]",
                    )}
                  >
                    <Avatar item={item} selected={isSelected} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium leading-tight">{item.label}</span>
                      {item.sub ? <span className="block truncate text-[11.5px] text-[#9b9fb3]">{item.sub}</span> : null}
                    </span>
                    {item.hint ? (
                      <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium", item.hintTone === "warn" ? "bg-[#fff8eb] text-[#9a5b00]" : "bg-[#f3f4f8] text-[#6f7282]")}>
                        {item.hint}
                      </span>
                    ) : null}
                    {isSelected ? <Check className="size-4 shrink-0 text-[#3848c7]" /> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Avatar({ item, selected = false }: { item: PickerItem; selected?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold",
        selected ? "bg-[#5566f6] text-white" : "bg-[#eef1ff] text-[#3848c7]",
      )}
    >
      {item.icon ?? initials(item.label)}
    </span>
  );
}
