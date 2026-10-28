"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Check, Printer } from "lucide-react";
import { useTranslations } from "next-intl";

export type PosterPickerItem = {
  key: string;
  title: string;
  /** Мини-лист, собранный на сервере (`PosterSheet size="preview"`). */
  preview: ReactNode;
  /** Средство из журнала учёта дезсредств организации. */
  inJournal: boolean;
};

export type PosterPickerGroup = { key: string; title: string; items: PosterPickerItem[] };

const BASE = "/production-control/documents/posters";

/**
 * Список плакатов по группам: галочка на каждой карточке, липкая панель
 * «Печатать выбранные / все» и переключатель «Ч/б». Выбор живёт в состоянии
 * страницы; печать открывает серверную страницу `posters/all?keys=…&bw=1`.
 * `pointId` — выбранная торговая точка (`&point=…`; null — точка по умолчанию).
 */
export function PostersPicker({ groups, pointId = null }: { groups: PosterPickerGroup[]; pointId?: string | null }) {
  const t = useTranslations("productionControl.posters");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bw, setBw] = useState(false);

  const allKeys = useMemo(() => groups.flatMap((group) => group.items.map((item) => item.key)), [groups]);
  const orderedSelection = allKeys.filter((key) => selected.has(key));
  const query = (keys?: string[]) => {
    const params = new URLSearchParams();
    if (keys?.length) params.set("keys", keys.join(","));
    if (bw) params.set("bw", "1");
    if (pointId) params.set("point", pointId);
    const text = params.toString();
    return text ? `?${text}` : "";
  };

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleGroup = (group: PosterPickerGroup) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const everySelected = group.items.every((item) => next.has(item.key));
      for (const item of group.items) {
        if (everySelected) next.delete(item.key);
        else next.add(item.key);
      }
      return next;
    });

  const primary =
    "inline-flex h-10 items-center gap-2 rounded-2xl px-4 text-[14px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

  return (
    <div className="space-y-6">
      <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-3xl border border-[#ececf4] bg-white/95 p-2.5 shadow-[0_10px_30px_-18px_rgba(11,16,36,0.25)] backdrop-blur">
        {orderedSelection.length > 0 ? (
          <Link
            href={`${BASE}/all${query(orderedSelection)}`}
            className={`${primary} bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]`}
          >
            <Printer className="size-4" aria-hidden />
            {t("printSelected", { count: String(orderedSelection.length) })}
          </Link>
        ) : (
          <span className={`${primary} cursor-not-allowed border border-[#ececf4] bg-[#f5f6ff] text-[#9a9db0]`} aria-disabled>
            <Printer className="size-4" aria-hidden />
            {t("printSelected", { count: "0" })}
          </span>
        )}
        <Link
          href={`${BASE}/all${query()}`}
          className={`${primary} border border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024]`}
        >
          {t("printAll")}
        </Link>
        <button
          type="button"
          role="switch"
          aria-checked={bw}
          title={t("bwHint")}
          onClick={() => setBw((value) => !value)}
          className={`${primary} border ${
            bw ? "border-[#0b1024] bg-[#0b1024] text-white hover:bg-[#1c2240]" : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          }`}
        >
          <span
            aria-hidden
            className={`flex size-4 items-center justify-center rounded-md border ${bw ? "border-white bg-white text-[#0b1024]" : "border-[#c9cde0]"}`}
          >
            {bw ? <Check className="size-3" /> : null}
          </span>
          {t("bw")}
        </button>
        <p className="min-w-0 flex-1 basis-[240px] text-[12.5px] leading-snug text-[#6f7282]">{t("selectHint")}</p>
      </div>

      {groups.map((group) => {
        const everySelected = group.items.every((item) => selected.has(item.key));
        return (
          <section key={group.key} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">{group.title}</h2>
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                className="rounded-xl px-2 py-1 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                {everySelected ? t("clearGroup") : t("selectGroup")}
              </button>
            </div>
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(270px,1fr))]">
              {group.items.map((item) => {
                const checked = selected.has(item.key);
                return (
                  <div key={item.key} className="relative">
                    <Link
                      href={`${BASE}/${item.key}${query()}`}
                      className={`group flex h-full flex-col items-center rounded-3xl border bg-white p-3 transition-colors duration-150 hover:border-[#5566f6]/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
                        checked ? "border-[#5566f6] ring-4 ring-[#5566f6]/10" : "border-[#ececf4]"
                      }`}
                    >
                      <div className="overflow-hidden rounded-2xl border border-[#ececf4]">{item.preview}</div>
                      <div className="mt-3 flex w-full items-start justify-between gap-3 px-1">
                        <span className="min-w-0 text-[14.5px] font-medium leading-snug text-[#0b1024]">{item.title}</span>
                        <span className="shrink-0 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 group-hover:text-[#5566f6]">
                          {t("open")}
                        </span>
                      </div>
                      {item.inJournal ? (
                        <span className="mt-2 self-start rounded-full bg-[#eef1ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7]">
                          {t("inJournal")}
                        </span>
                      ) : null}
                    </Link>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={t("selectPoster", { title: item.title })}
                      onClick={() => toggle(item.key)}
                      className={`absolute left-5 top-5 flex size-7 items-center justify-center rounded-xl border shadow-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
                        checked ? "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]" : "border-[#c9cde0] bg-white/95 text-transparent hover:border-[#5566f6]"
                      }`}
                    >
                      <Check className="size-4" aria-hidden />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
