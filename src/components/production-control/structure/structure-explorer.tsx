"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { PpkStatus } from "@/lib/ppk/status";

export type ExplorerItem = {
  id: string;
  number: string;
  title: string;
  href: string;
  status: PpkStatus;
  /** «ППК 003» — утверждённая редакция документа пункта; null — документа нет или не утверждён. */
  revision: string | null;
  /** У пункта есть документ с редакцией, но текущая не утверждена. */
  revisionPending: boolean;
};
export type ExplorerSection = { key: string; title: string; appendix: boolean; items: ExplorerItem[] };

type Filter = "all" | "empty" | "started" | "done";
const FILTERS: Filter[] = ["all", "empty", "started", "done"];

/**
 * Структура ППК в новом виде обзора (2026-11-24, по образцу FoodDocs и
 * Safefood 360): фильтр «что не заполнено», переход к разделу с его
 * прогрессом, номер редакции у документов. Ссылки — те же окна пунктов.
 */
export function PpkStructureExplorer({ sections }: { sections: ExplorerSection[] }) {
  const t = useTranslations("productionControl.overviewV2");
  const tStatus = useTranslations("navigation.shell.status");
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const all = sections.flatMap((section) => section.items);
    return {
      all: all.length,
      empty: all.filter((item) => item.status === "empty").length,
      started: all.filter((item) => item.status === "started").length,
      done: all.filter((item) => item.status === "done").length,
    } satisfies Record<Filter, number>;
  }, [sections]);
  const visible = (item: ExplorerItem) => filter === "all" || item.status === filter;
  const shown = sections.map((section) => ({ ...section, items: section.items.filter(visible) })).filter((section) => section.items.length > 0);

  return (
    <section aria-labelledby="ppk-structure-title" className="space-y-3" data-ppk-structure data-ppk-structure-v2>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ppk-structure-title" className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">
          {t("structureTitle")}
        </h2>
        <div role="radiogroup" aria-label={t("filterLabel")} className="flex flex-wrap gap-1.5">
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={filter === value}
              data-ppk-filter={value}
              onClick={() => setFilter(value)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                filter === value ? "bg-[#eef1ff] font-medium text-[#3848c7] ring-1 ring-[#5566f6]" : "bg-[var(--app-veil)] text-[#3c4053] hover:bg-[var(--app-veil-hover)]",
              )}
            >
              {t(`filters.${value}`)}
              <span className="tabular-nums text-[#6f7282]">{counts[value]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Разделы: переход к разделу и его прогресс. */}
      <nav aria-label={t("sectionsNav")} className="flex flex-wrap gap-1.5">
        {sections.map((section) => {
          const done = section.items.filter((item) => item.status === "done").length;
          return (
            <a
              key={section.key}
              href={`#ppk-section-${section.key}`}
              onClick={(event) => {
                // Без `#раздела` в адресе: иначе после закрытия окна пункта
                // браузер снова прыгал бы к разделу.
                const target = document.getElementById(`ppk-section-${section.key}`);
                if (!target) return;
                event.preventDefault();
                const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
                target.focus({ preventScroll: true });
              }}
              className="inline-flex h-8 items-center gap-2 rounded-xl bg-[var(--app-veil)] px-3 text-[13px] text-[#3c4053] transition-colors duration-150 hover:bg-[var(--app-veil-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              data-ppk-section-link={section.key}
            >
              <span className="max-w-[16rem] truncate">{section.title}</span>
              <span className="tabular-nums text-[#6f7282]">
                {done}/{section.items.length}
              </span>
            </a>
          );
        })}
      </nav>

      {shown.length === 0 ? (
        <p className="rounded-3xl bg-white px-5 py-6 text-center text-[14px] text-[#6f7282]">{t("noMatches")}</p>
      ) : (
        <div className="space-y-3">
          {shown.map((section) => (
            <div
              key={section.key}
              id={`ppk-section-${section.key}`}
              tabIndex={-1}
              className="scroll-mt-24 rounded-3xl bg-white p-3 outline-none sm:p-4"
              data-ppk-section={section.key}
            >
              <h3 className="px-2 pb-1 text-[15.5px] leading-snug font-semibold text-[#0b1024]">{section.title}</h3>
              <ol>
                {section.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      scroll={false}
                      prefetch={false}
                      data-ppk-item={item.id}
                      className="group flex min-h-[40px] items-start gap-3 rounded-xl px-2 py-2 text-[14px] leading-snug transition-colors duration-150 hover:bg-[var(--app-veil)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                    >
                      <span
                        className={
                          section.appendix
                            ? "shrink-0 pt-px text-[13px] whitespace-nowrap tabular-nums text-[#6f7282]"
                            : "w-9 shrink-0 pt-px text-[13px] tabular-nums text-[#6f7282]"
                        }
                      >
                        {item.number}
                      </span>
                      <span className="min-w-0 flex-1 text-[#3848c7] underline-offset-[3px] group-hover:underline">{item.title}</span>
                      {item.revision ? (
                        <span className="shrink-0 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[11.5px] font-medium text-[#116b2a] tabular-nums" data-ppk-revision-badge>
                          {item.revision}
                        </span>
                      ) : item.revisionPending ? (
                        <span className="shrink-0 rounded-full bg-[#fff7e6] px-2 py-0.5 text-[11.5px] font-medium text-[#b45309]" data-ppk-revision-badge>
                          {t("revisionPending")}
                        </span>
                      ) : null}
                      {item.status === "info" ? null : (
                        <span
                          role="img"
                          aria-label={tStatus(item.status)}
                          title={tStatus(item.status)}
                          className={cn(
                            "mt-1.5 size-2 shrink-0 rounded-full",
                            item.status === "done" && "bg-[#1f9d55]",
                            item.status === "started" && "bg-[#f5b301]",
                            item.status === "empty" && "border-[1.5px] border-[#dcdfed]",
                          )}
                        />
                      )}
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
