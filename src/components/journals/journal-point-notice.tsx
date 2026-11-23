"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Store } from "lucide-react";
import { useSwitchBuilding } from "@/components/layout/location-switcher";

/**
 * Над списком документов журнала, пока в шапке «Выберите объект» (офис или
 * вся организация): документ журнала создаётся для объекта (владелец,
 * 2026-11-23: «офис — не объект… обязательно привязать к объекту, оттуда —
 * ссылка „создать объект“»). Кнопка объекта тихо включает его в шапке —
 * страница остаётся та же, но уже для объекта; «Создать объект» — мастер.
 */
export function JournalPointNotice({
  options,
  createHref,
}: {
  options: Array<{ id: string; name: string }>;
  /** «Создать объект» — тому, кто заводит объекты; null — ссылки нет. */
  createHref: string | null;
}) {
  const t = useTranslations("journalControls.pointNotice");
  const { switchTo, busyId } = useSwitchBuilding({ canManagePoints: Boolean(createHref) });

  return (
    <section
      data-journal-point-notice
      className="rounded-2xl bg-[var(--app-veil)] px-4 py-3.5 sm:px-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--app-surface,#fff)] text-[#5566f6]">
          <Store className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-[#0b1024]">{t("title")}</h2>
          <p className="mt-0.5 text-[13.5px] leading-[1.5] text-[#6f7282]">
            {options.length > 0 ? t("body") : t("empty")}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => void switchTo({ id: option.id, name: option.name, address: null }, null)}
                disabled={busyId !== null}
                data-journal-point-option={option.id}
                className="inline-flex h-9 max-w-full items-center gap-1.5 rounded-xl bg-[var(--app-surface,#fff)] px-3 text-[13.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-70"
              >
                {busyId === option.id ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" aria-hidden />
                ) : (
                  <Store className="size-4 shrink-0 text-[#9b9fb3]" aria-hidden />
                )}
                <span className="truncate">{option.name}</span>
              </button>
            ))}
            {createHref ? (
              <Link
                href={createHref}
                data-journal-point-create
                className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[var(--app-veil-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                <Plus className="size-4" aria-hidden />
                {t("create")}
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
