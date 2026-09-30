"use client";

import { usePathname } from "next/navigation";

import { PageSkeleton, Skeleton, SkeletonTable } from "@/components/ui/skeleton";
import { isSectionRoot } from "@/components/ui/skeleton-routes";
import {
  JOURNAL_ITEM_CLASS,
  JOURNAL_LIST_CLASS,
  JOURNAL_ROW_CLASS,
  JOURNAL_THUMB_SIZE_CLASS,
  JOURNAL_TOOLBAR_CLASS,
} from "@/components/dashboard/dashboard-journals-layout";

/**
 * Загрузка `/dashboard/*`. Вложенные страницы («Догнать пропущенное»,
 * «Аудит соответствия») грузились под скелетом дашборда и потом
 * перестраивались в свою раскладку — им общий скелет страницы.
 */
export default function DashboardLoading() {
  if (!isSectionRoot(usePathname(), "/dashboard")) {
    return <PageSkeleton label="Загружаем страницу…" body="list" />;
  }
  return <DashboardSkeleton />;
}

/**
 * Skeleton дашборда. Повторяет структуру `/dashboard`: секция
 * «Обязательные журналы» без карточки — заголовок на фоне страницы,
 * панель (кнопки и поиск), строки «превью + название» теми же классами,
 * что и настоящий список; ниже плитки быстрых действий и таблица
 * последних записей.
 */
function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Загружаем дашборд…</span>

      <div data-skeleton="compliance-grid">
        <div className="flex min-h-12 items-center gap-2 py-1">
          <Skeleton className="h-5 w-56 rounded-lg sm:h-6 sm:w-80" />
          <Skeleton className="ml-auto size-6 shrink-0 rounded-full" />
        </div>
        <div className="space-y-5 pt-3 sm:pt-4">
          <div className={JOURNAL_TOOLBAR_CLASS}>
            <div className="grid grid-cols-2 gap-2 sm:flex lg:order-3 lg:ml-auto">
              <Skeleton className="h-11 rounded-2xl sm:w-[180px]" />
              <Skeleton className="h-11 rounded-2xl sm:w-[180px]" />
            </div>
            <Skeleton className="h-12 w-full rounded-2xl lg:order-1 lg:max-w-[420px]" />
          </div>
          <div className={JOURNAL_LIST_CLASS}>
            {Array.from({ length: 9 }).map((_, index) => (
              <div key={index} className={JOURNAL_ITEM_CLASS}>
                <div className={JOURNAL_ROW_CLASS}>
                  <Skeleton className={`${JOURNAL_THUMB_SIZE_CLASS} shrink-0 rounded-[8px]`} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-full rounded-lg" />
                    <Skeleton className="h-3.5 w-2/3 rounded-lg" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-white px-4 py-4"
          >
            <Skeleton className="size-11 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/3 rounded-lg" />
              <Skeleton className="h-3 w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>

      <SkeletonTable rows={8} columns={6} />
    </div>
  );
}
