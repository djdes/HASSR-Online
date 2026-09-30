"use client";

import { usePathname } from "next/navigation";

import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { isSectionRoot } from "@/components/ui/skeleton-routes";

/**
 * Загрузка раздела `/settings/*`.
 *
 * Этот `loading.tsx` — запасной для ВСЕХ подстраниц настроек (своих у них
 * нет), поэтому смотрим на адрес: хабу — его раскладка с тёмным hero,
 * подстраницам — общий скелет страницы (шапка + панель). Раньше любая
 * подстраница, от «Сотрудников» до «Баланса», грузилась под скелетом хаба
 * с тёмным баннером, которого на ней нет, — экран «прыгал».
 */
export default function SettingsLoading() {
  if (!isSectionRoot(usePathname(), "/settings")) {
    return <PageSkeleton label="Загружаем настройки…" body="panel" />;
  }
  return <SettingsHubSkeleton />;
}

/**
 * Skeleton хаба `/settings`. Повторяет структуру страницы: тёмный
 * hero-баннер со счётчиками (единственное место кабинета с тёмным
 * hero — см. `.claude/skills/design-system`), плашка «Быстрый старт»,
 * группы карточек разделов.
 */
function SettingsHubSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Загружаем настройки…</span>

      {/* Hero */}
      <section className="rounded-3xl border border-[#ececf4] bg-[#0b1024] p-5 sm:p-8 md:p-10">
        <div className="flex items-start gap-4">
          <Skeleton className="size-12 shrink-0 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-40 rounded-xl" />
            <Skeleton className="h-4 w-56 rounded-lg" />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-4 gap-2 sm:mt-8 sm:gap-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[58px] rounded-2xl" />
          ))}
        </div>
      </section>

      {/* Быстрый старт */}
      <Skeleton className="h-[92px] w-full rounded-3xl sm:h-[112px]" />

      {/* Группы разделов */}
      {Array.from({ length: 3 }).map((_, groupIndex) => (
        <section key={groupIndex} className="space-y-3">
          <div className="space-y-1.5 px-1">
            <Skeleton className="h-4 w-40 rounded-lg" />
            <Skeleton className="h-3 w-64 max-w-full rounded-lg" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, cardIndex) => (
              <div
                key={cardIndex}
                className="flex items-start gap-4 rounded-2xl border border-[#ececf4] bg-white px-5 py-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
              >
                <Skeleton className="size-10 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3 rounded-lg" />
                  <Skeleton className="h-3 w-full rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
