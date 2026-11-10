"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { ArrowRight, Layers, Search, SearchX, X } from "lucide-react";
import Link from "@/components/i18n/localized-link";
import { journalMatchesQuery, normalizeJournalSearch } from "@/lib/journal-search";

export type PublicJournalCatalogItem = {
  code: string;
  name: string;
  tagline: string;
  why: string;
  hasSample: boolean;
};

export type PublicJournalCatalogGroup = {
  category: string;
  label: string;
  items: PublicJournalCatalogItem[];
};

type JournalsInfoCatalogProps = {
  groups: PublicJournalCatalogGroup[];
  groupCountLabels: Record<number, string>;
  moreLabel: string;
  searchPlaceholder: string;
  searchAria: string;
  clearSearchLabel: string;
  emptyTitle: string;
  emptyHint: string;
};

export function JournalsInfoCatalog({
  groups,
  groupCountLabels,
  moreLabel,
  searchPlaceholder,
  searchAria,
  clearSearchLabel,
  emptyTitle,
  emptyHint,
}: JournalsInfoCatalogProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = useMemo(() => normalizeJournalSearch(deferredQuery), [deferredQuery]);

  const totalCount = useMemo(
    () => groups.reduce((acc, g) => acc + g.items.length, 0),
    [groups],
  );

  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((j) =>
          journalMatchesQuery([j.name, j.tagline, j.why, j.code], normalizedQuery),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, normalizedQuery]);

  const matchedCount = useMemo(
    () => filteredGroups.reduce((acc, g) => acc + g.items.length, 0),
    [filteredGroups],
  );

  return (
    <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 sm:py-16">
      <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-[460px]">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#6f7282]"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchAria}
            autoComplete="off"
            spellCheck={false}
            className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-[#fafbff] pl-11 pr-10 text-[15px] text-[#0b1024] placeholder:text-[#8a8ea4] transition-all focus:border-[#5566f6] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#5566f6]/12 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={clearSearchLabel}
              title={clearSearchLabel}
              className="absolute right-3 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-xl text-[#6f7282] transition-colors hover:bg-[#eef1ff] hover:text-[#0b1024]"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        {normalizedQuery ? (
          <div className="text-[13px] font-medium text-[#6f7282]">
            {matchedCount} / {totalCount}
          </div>
        ) : null}
      </div>

      {filteredGroups.length === 0 ? (
        <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] px-6 py-12 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <SearchX className="size-6" />
          </div>
          <div className="mt-4 text-[18px] font-semibold text-[#0b1024]">{emptyTitle}</div>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[14px] text-[#6f7282]">{emptyHint}</p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            <X className="size-3.5" />
            {clearSearchLabel}
          </button>
        </div>
      ) : (
        filteredGroups.map((group) => (
          <div key={group.category} className="mb-14">
            <div className="flex flex-wrap items-center gap-3">
              <Layers className="size-5 text-[#3848c7]" />
              <h2 className="text-[24px] font-semibold tracking-tight">{group.label}</h2>
              <span className="text-[14px] text-[#6f7282]">
                {groupCountLabels[group.items.length] ?? String(group.items.length)}
              </span>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((j) => (
                <Link
                  key={j.code}
                  href={`/journals-info/${j.code}`}
                  title={j.name}
                  className="group flex min-w-0 flex-col rounded-2xl border border-[#ececf4] bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-[#5566f6]/40 hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)]"
                >
                  {j.hasSample ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/journal-samples/${j.code}.webp`}
                      alt={j.name}
                      width={1228}
                      height={862}
                      loading="lazy"
                      className="mb-4 aspect-[1228/862] w-full rounded-xl border border-[#ececf4] bg-white object-cover object-top"
                    />
                  ) : null}
                  <div className="break-all text-[11px] font-medium uppercase tracking-[0.14em] text-[#6f7282]">
                    {j.code}
                  </div>
                  <div className="mt-1 text-[17px] font-semibold leading-snug group-hover:text-[#3848c7]">
                    {j.tagline}
                  </div>
                  <p className="mt-2 line-clamp-3 text-[13px] leading-[1.55] text-[#6f7282]">
                    {j.why}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-[#3848c7]">
                    {moreLabel}
                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
