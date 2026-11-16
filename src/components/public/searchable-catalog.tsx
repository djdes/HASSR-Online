"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { journalMatchesQuery } from "@/lib/journal-search";

type CatalogGroup = {
  id: string;
  title: ReactNode;
  items: { id: string; searchText: string; content: ReactNode }[];
};

export function SearchableCatalog({
  groups,
  label,
  listClassName,
}: {
  groups: CatalogGroup[];
  label: string;
  listClassName: string;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const copy = {
    clear: "Сбросить поиск",
    empty: "Ничего не найдено",
    hint: "Измените запрос или сбросьте поиск.",
    found: "Найдено",
  };
  const visible = groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => journalMatchesQuery([item.searchText], query)),
  })).filter((group) => group.items.length > 0);
  const count = visible.reduce((sum, group) => sum + group.items.length, 0);
  const reset = () => {
    setQuery("");
    input.current?.focus();
  };

  return (
    <>
      <div role="search" className="mb-8">
        <label htmlFor={id} className="mb-2 block text-[14px] font-medium text-[#0b1024]">{label}</label>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-4 size-4 text-[#6f7282]" />
          <input
            ref={input}
            id={id}
            type="search"
            value={query}
            placeholder="Поиск по названию, описанию или нормативу"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") reset(); }}
            className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white pl-11 pr-12 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query && <button type="button" onClick={reset} aria-label={copy.clear} className="absolute right-1 top-1 inline-flex size-10 items-center justify-center rounded-2xl text-[#6f7282] hover:bg-[#f5f6ff] focus-visible:outline-2 focus-visible:outline-[#5566f6]"><X aria-hidden="true" className="size-4" /></button>}
        </div>
        <p role="status" className="mt-2 text-[13px] tabular-nums text-[#6f7282]">{copy.found}: {count}</p>
      </div>
      {visible.map((group) => (
        <div key={group.id} className="mb-12 last:mb-0">
          <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {group.title}
            <span className="text-[13px] tabular-nums text-[#6f7282]">{group.items.length}</span>
          </div>
          <div className={listClassName}>{group.items.map((item) => <div key={item.id} className="min-w-0">{item.content}</div>)}</div>
        </div>
      ))}
      {count === 0 && <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center">
        <p className="text-[15px] font-medium text-[#0b1024]">{copy.empty}</p>
        <p className="mt-2 text-[13px] text-[#6f7282]">{copy.hint}</p>
        <button type="button" onClick={reset} className="mt-4 rounded-2xl border border-[#dcdfed] bg-white px-4 py-2 text-[14px] text-[#3848c7] hover:bg-[#f5f6ff] focus-visible:outline-2 focus-visible:outline-[#5566f6]">{copy.clear}</button>
      </div>}
    </>
  );
}
