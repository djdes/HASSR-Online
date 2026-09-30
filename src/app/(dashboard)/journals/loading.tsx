"use client";

import { usePathname } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";
import { journalsSkeletonFor } from "@/components/ui/skeleton-routes";

import JournalCodeLoading from "./[code]/loading";

/**
 * Загрузка раздела `/journals/*`.
 *
 * Этот `loading.tsx` — внешний для всего раздела: при полной загрузке
 * журнала или документа браузер сначала получал именно его, и человек
 * видел сетку каталога журналов, потом скелет списка документов или
 * документа, потом страницу — экран «прыгал» два раза. Поэтому смотрим на
 * адрес: каталогу — его скелет, всему, что глубже, — скелет той страницы,
 * которая откроется (выбирает `[code]/loading.tsx`).
 */
export default function JournalsLoading() {
  if (journalsSkeletonFor(usePathname()) !== "catalog") return <JournalCodeLoading />;
  return <JournalsCatalogSkeleton />;
}

/**
 * Skeleton списка журналов. Повторяет структуру `/journals`:
 * заголовок + подсказка, строка поиска/фильтров, сетка карточек.
 */
function JournalsCatalogSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Загружаем журналы…</span>

      <div className="space-y-3">
        <Skeleton className="h-9 w-[280px] rounded-2xl" />
        <Skeleton className="h-4 w-[420px] max-w-full rounded-xl" />
      </div>

      <Skeleton className="h-14 w-full rounded-2xl" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }).map((_, index) => (
          <div
            key={index}
            className="rounded-2xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
          >
            <div className="flex items-start gap-3">
              <Skeleton className="size-11 shrink-0 rounded-2xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-[80%] rounded-lg" />
                <Skeleton className="h-3 w-[55%] rounded-lg" />
              </div>
            </div>
            <Skeleton className="mt-5 h-3 w-full rounded-lg" />
            <Skeleton className="mt-2 h-3 w-[70%] rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
