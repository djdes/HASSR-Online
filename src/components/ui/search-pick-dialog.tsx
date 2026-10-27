"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NavIcon } from "@/components/layout/nav-icons";

export type SearchPickItem = { id: string; label: string; hint?: string; icon?: string };
export type SearchPickGroup = { label: string | null; items: SearchPickItem[] };

/**
 * Окно «выберите из списка»: поиск сверху, группы ниже, выбор — одним
 * нажатием на строку. Для «Избранного» главной и «Добавить журнал» точки.
 * `emptyText` — когда выбирать вообще нечего, `notFoundText` — когда поиск
 * ничего не нашёл.
 */
export function SearchPickDialog({
  open,
  onOpenChange,
  title,
  description,
  searchPlaceholder,
  emptyText,
  notFoundText,
  groups,
  busy = false,
  onPick,
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  searchPlaceholder: string;
  emptyText: string;
  notFoundText: string;
  groups: SearchPickGroup[];
  busy?: boolean;
  onPick: (id: string) => void;
  testId?: string;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    if (!needle) return groups.filter((group) => group.items.length > 0);
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${item.label} ${item.hint ?? ""} ${group.label ?? ""}`.toLocaleLowerCase("ru-RU").includes(needle),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-[520px]"
        data-search-pick={testId}
      >
        <DialogHeader className="shrink-0 border-b border-[#ececf4] px-5 pt-5 pb-4 text-left">
          <DialogTitle className="pr-8 text-[19px] font-semibold tracking-[-0.01em] text-[#0b1024]">{title}</DialogTitle>
          <DialogDescription className="text-[13.5px] text-[#6f7282]">{description}</DialogDescription>
          {total > 0 ? (
            <label className="relative mt-3 block">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#9b9fb3]" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                autoFocus
                className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white pr-4 pl-10 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15 focus:outline-none"
              />
            </label>
          ) : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {shown.length === 0 ? (
            <p className="px-3 py-8 text-center text-[14px] text-[#6f7282]">{total === 0 ? emptyText : notFoundText}</p>
          ) : (
            shown.map((group, index) => (
              <div key={group.label ?? `group-${index}`} className="pb-2">
                {group.label ? (
                  <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-[0.14em] text-[#9b9fb3] uppercase">
                    {group.label}
                  </div>
                ) : null}
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={busy}
                    onClick={() => onPick(item.id)}
                    data-pick-item={item.id}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:bg-[#f5f6ff] focus-visible:outline-none disabled:opacity-60",
                    )}
                  >
                    {item.icon ? (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
                        <NavIcon name={item.icon} className="size-4" />
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-medium text-[#0b1024]">{item.label}</span>
                      {item.hint ? <span className="block text-[12.5px] text-[#6f7282]">{item.hint}</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
