"use client";

import { usePathname } from "next/navigation";

import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { journalsSkeletonFor } from "@/components/ui/skeleton-routes";

/**
 * Загрузка документа журнала. Граница срабатывает и для проверки документа
 * (`…/documents/<id>/verify`) — ей общий скелет страницы, а не сетка.
 */
export default function JournalDocumentLoading() {
  if (journalsSkeletonFor(usePathname()) === "page") {
    return <PageSkeleton label="Загружаем проверку документа…" body="list" />;
  }
  return <JournalDocumentGridSkeleton />;
}

/**
 * Skeleton страницы одного документа-журнала.
 * Повторяет реальную раскладку: back-link + действия, ХАССП-шапка
 * (три колонки), заголовок журнала и сетка «строки × дни».
 */
function JournalDocumentGridSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Загружаем документ…</span>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-5 w-[180px] rounded-lg" />
        <div className="flex gap-2">
          <Skeleton className="h-11 w-[120px] rounded-2xl" />
          <Skeleton className="h-11 w-[190px] rounded-2xl" />
        </div>
      </div>

      {/* ХАССП-шапка документа */}
      <div className="mx-auto grid w-full max-w-[820px] grid-cols-[1fr_2fr_0.9fr] gap-px overflow-hidden rounded-2xl border border-[#ececf4] bg-[#ececf4]">
        <div className="flex items-center justify-center bg-white px-4 py-6">
          <Skeleton className="h-4 w-[80%] rounded-lg" />
        </div>
        <div className="grid grid-rows-2 gap-px bg-[#ececf4]">
          <div className="flex items-center justify-center bg-white px-4 py-3">
            <Skeleton className="h-3 w-[45%] rounded-lg" />
          </div>
          <div className="flex items-center justify-center bg-white px-4 py-3">
            <Skeleton className="h-3 w-[70%] rounded-lg" />
          </div>
        </div>
        <div className="flex items-center justify-center bg-white px-4 py-6">
          <Skeleton className="h-3 w-[70%] rounded-lg" />
        </div>
      </div>

      <div className="flex justify-center">
        <Skeleton className="h-6 w-[320px] max-w-full rounded-xl" />
      </div>

      {/* Сетка документа */}
      <div className="overflow-hidden rounded-[22px] border border-[#eceef5] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-3 border-b border-[#ececf4] bg-[#f8f9fc] px-4 py-3">
          <Skeleton className="h-4 w-[220px] rounded-lg" />
          <div className="ml-auto flex gap-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="size-6 rounded-md" />
            ))}
          </div>
        </div>
        {Array.from({ length: 7 }).map((_, row) => (
          <div
            key={row}
            className="flex items-center gap-3 border-b border-[#ececf4] px-4 py-3 last:border-b-0"
          >
            <Skeleton className="h-4 w-[220px] rounded-lg" />
            <div className="ml-auto flex gap-2">
              {Array.from({ length: 8 }).map((_, cell) => (
                <Skeleton key={cell} className="size-6 rounded-md" />
              ))}
            </div>
          </div>
        ))}
      </div>

      <Skeleton className="mx-auto h-24 w-full max-w-[820px] rounded-2xl" />
    </div>
  );
}
