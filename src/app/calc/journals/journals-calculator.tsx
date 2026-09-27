"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";

import { sortJournalsByName } from "@/lib/journal-sort";
import { OPTION_LABEL, VENUE_LABEL, pickJournals, type VenueKind, type VenueOption } from "@/lib/seo/journal-picker";

const CHIP = "inline-flex h-10 items-center rounded-full border px-4 text-[14px] font-medium transition-colors";

export function JournalsCalculator({ names }: { names: Record<string, string> }) {
  const [kind, setKind] = useState<VenueKind>("cafe");
  const [options, setOptions] = useState<VenueOption[]>(["fridges", "hotFood"]);
  // Набор — по алфавиту названий.
  const codes = useMemo(
    () => sortJournalsByName(pickJournals(kind, options), (code) => names[code] ?? code),
    [kind, options, names],
  );

  function toggle(o: VenueOption) {
    setOptions((prev) => (prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]));
  }

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-6">
        <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">1. Тип заведения</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(VENUE_LABEL) as VenueKind[]).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={`${CHIP} ${kind === k ? "border-[#5566f6] bg-[#5566f6] text-white" : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"}`}>
                {VENUE_LABEL[k]}
              </button>
            ))}
          </div>
        </section>
        <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">2. Особенности</div>
          <ul className="mt-3 space-y-2">
            {(Object.keys(OPTION_LABEL) as VenueOption[]).map((o) => (
              <li key={o}>
                <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#ececf4] px-4 py-3 text-[14px] transition-colors hover:bg-[#fafbff]">
                  <input type="checkbox" checked={options.includes(o)} onChange={() => toggle(o)} className="size-4 accent-[#5566f6]" />
                  {OPTION_LABEL[o]}
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6 lg:sticky lg:top-6 lg:self-start">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Ваш набор</div>
          <div className="text-[28px] font-semibold tabular-nums" data-testid="journals-count">{codes.length}</div>
        </div>
        <ul className="mt-3 space-y-1.5" data-testid="journals-list">
          {codes.map((code) => (
            <li key={code}>
              <Link href={`/journals-info/${code}`} className="flex items-center gap-2.5 rounded-2xl bg-white px-3.5 py-2.5 text-[14px] transition-colors hover:bg-[#f5f6ff]">
                <CheckCircle2 className="size-4 shrink-0 text-[#116b2a]" />
                <span className="min-w-0">{names[code] ?? code}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/register" className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]">
          Завести эти журналы бесплатно
          <ArrowRight className="size-4" />
        </Link>
        <p className="mt-3 text-[12px] leading-relaxed text-[#9b9fb3]">Все журналы уже есть в WeSetup — набор включается в настройках за минуту.</p>
      </section>
    </div>
  );
}
