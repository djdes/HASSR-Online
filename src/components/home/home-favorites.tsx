"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Star, X } from "lucide-react";
import type { FavoriteCandidate } from "@/lib/home-page";
import { HOME_FAVORITES_MAX } from "@/lib/home-page";
import { navTone } from "@/lib/nav-tones";
import { NavIconChip } from "@/components/layout/nav-icons";
import { SearchPickDialog, type SearchPickGroup } from "@/components/ui/search-pick-dialog";

type Strings = {
  title: string;
  add: string;
  addHint: string;
  remove: string;
  pickDescription: string;
  search: string;
  nothing: string;
  saved: string;
  failed: string;
};

/**
 * Три слота «Избранного» на главной (эскиз: пунктирные «Избранное»): пустой
 * слот — «Добавить в избранное» с выбором страницы из своего меню, заполненный
 * — ссылка на страницу и «×», чтобы открепить. Список хранится на сервере
 * (`PUT /api/me/home-favorites`), поэтому одинаков на всех устройствах.
 */
export function HomeFavorites({
  pinned,
  candidates,
  strings,
}: {
  pinned: string[];
  candidates: FavoriteCandidate[];
  strings: Strings;
}) {
  const router = useRouter();
  const [hrefs, setHrefs] = useState(pinned);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const byHref = new Map(candidates.map((candidate) => [candidate.href, candidate]));

  async function save(next: string[]) {
    const previous = hrefs;
    setHrefs(next);
    setBusy(true);
    try {
      const response = await fetch("/api/me/home-favorites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hrefs: next }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { hrefs: string[] };
      setHrefs(data.hrefs);
      toast.success(strings.saved);
      router.refresh();
      return true;
    } catch {
      setHrefs(previous);
      toast.error(strings.failed);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // В окне выбора — страницы, которых ещё нет в избранном, по разделам меню.
  const groups: SearchPickGroup[] = [];
  for (const candidate of candidates) {
    if (hrefs.includes(candidate.href)) continue;
    let group = groups.find((entry) => entry.label === candidate.sectionLabel);
    if (!group) {
      group = { label: candidate.sectionLabel, items: [] };
      groups.push(group);
    }
    group.items.push({ id: candidate.href, label: candidate.label, icon: candidate.icon });
  }

  const slots = Array.from({ length: HOME_FAVORITES_MAX }, (_, index) => hrefs[index] ?? null);

  return (
    <>
      {slots.map((href, index) => {
        const page = href ? byHref.get(href) : undefined;
        if (!href || !page) {
          return (
            <button
              key={`empty-${index}`}
              type="button"
              onClick={() => setPicking(true)}
              disabled={busy}
              data-home-favorite-empty
              data-nav-row
              style={{ "--nav-i": index + 1 } as CSSProperties}
              className="group flex min-h-[148px] flex-col items-start justify-between rounded-3xl border-2 border-dashed border-[#dcdfed] bg-[#fafbff] p-5 text-left transition-colors duration-150 hover:border-[#5566f6]/50 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60"
            >
              <span className="flex size-10 items-center justify-center rounded-2xl bg-white text-[#5566f6] shadow-[0_0_0_1px_rgba(220,223,237,0.9)] transition-colors duration-150 group-hover:bg-[#5566f6] group-hover:text-white">
                <Plus className="size-5" aria-hidden />
              </span>
              <span>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.14em] text-[#9b9fb3] uppercase">
                  <Star className="size-3.5 text-[#c27803]" aria-hidden />
                  {strings.title}
                </span>
                <span className="mt-1 block text-[14.5px] font-medium leading-tight text-[#3848c7]">{strings.add}</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-[#6f7282]">{strings.addHint}</span>
              </span>
            </button>
          );
        }
        return (
          <div key={href} className="relative" data-home-favorite={href}>
            <Link
              href={href}
              data-tone={navTone(page.icon)}
              data-nav-row
              style={{ "--nav-i": index + 1 } as CSSProperties}
              className="group flex min-h-[148px] flex-col justify-between rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-[border-color,box-shadow] duration-150 hover:border-[var(--tone-glow)] hover:shadow-[0_16px_40px_-24px_var(--tone-glow)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <NavIconChip name={page.icon} className="size-10 rounded-2xl" iconClassName="size-5" />
              <span className="pr-6">
                <span className="block text-[11.5px] font-medium text-[#9b9fb3]">{page.sectionLabel}</span>
                <span className="mt-0.5 block text-[15px] font-semibold leading-tight text-[#0b1024]">{page.label}</span>
              </span>
            </Link>
            <button
              type="button"
              onClick={() => void save(hrefs.filter((entry) => entry !== href))}
              disabled={busy}
              aria-label={`${strings.remove}: ${page.label}`}
              title={strings.remove}
              className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full text-[#9b9fb3] transition-colors duration-150 hover:bg-[#fff4f2] hover:text-[#a13a32] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        );
      })}
      <SearchPickDialog
        open={picking}
        onOpenChange={setPicking}
        title={strings.add}
        description={strings.pickDescription}
        searchPlaceholder={strings.search}
        emptyText={strings.nothing}
        notFoundText={strings.nothing}
        groups={groups}
        busy={busy}
        testId="home-favorites"
        onPick={async (href) => {
          if (await save([...hrefs, href].slice(0, HOME_FAVORITES_MAX))) setPicking(false);
        }}
      />
    </>
  );
}
