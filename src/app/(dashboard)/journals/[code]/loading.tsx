"use client";

import { usePathname } from "next/navigation";

import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { journalsSkeletonFor } from "@/components/ui/skeleton-routes";
import {
  JOURNAL_LIST_CARDS_CLASS,
  JOURNAL_LIST_STACK_CLASS,
  JOURNAL_TAB_RAIL_CLASS,
} from "@/components/journals/journal-responsive";

import JournalDocumentLoading from "./documents/[docId]/loading";

/**
 * Загрузка поддерева `/journals/[code]/*` — скелет той страницы, которая
 * откроется. Этот `loading.tsx` — запасной и для документа (у его layout'а
 * свой запрос к базе, и до него срабатывает эта граница), и для новой
 * записи, инструкции, справки: раньше все они грузились под скелетом
 * списка документов и потом «перепрыгивали» в свою раскладку.
 */
export default function JournalCodeLoading() {
  const kind = journalsSkeletonFor(usePathname());
  if (kind === "document") return <JournalDocumentLoading />;
  if (kind === "page") return <PageSkeleton label="Загружаем журнал…" body="panel" />;
  return <JournalListSkeleton />;
}

/**
 * Skeleton списка документов внутри журнала (`/journals/[code]`).
 * Повторяет `JournalTopBar` (заголовок + блок кнопок `JournalListActions`:
 * «QR-точка контроля» во всю ширину над рядом «Создать документ |
 * Инструкция»), `JournalTabs` («Активные / Закрытые») и карточки документов.
 *
 * Строка шапки и сетка кнопок — те же классы, что
 * `JOURNAL_LIST_HEADER_ROW_CLASS` и `JOURNAL_LIST_ACTIONS_GRID_CLASS`
 * (journal-list-actions.tsx — клиентский модуль, серверный скелет не может
 * взять оттуда строку, поэтому совпадение держит тест
 * `journal-page-polish.test.ts`). Вкладки — без полосы под рядом, как
 * `JournalTabs`. Шаг между шапкой, вкладками и карточками — те же токены,
 * что у списков (`JOURNAL_LIST_STACK_CLASS`, `JOURNAL_LIST_CARDS_CLASS`):
 * страница после загрузки не прыгает.
 */
function JournalListSkeleton() {
  return (
    <div className={JOURNAL_LIST_STACK_CLASS} aria-busy="true" aria-live="polite">
      <span className="sr-only">Загружаем документы журнала…</span>

      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-5 sm:items-center">
        <Skeleton className="h-9 w-[320px] max-w-full rounded-2xl" />
        <div className="grid w-full grid-cols-2 gap-x-3 gap-y-5 sm:w-[440px] sm:shrink-0">
          <Skeleton className="col-span-2 h-12 w-full rounded-2xl" />
          <Skeleton className="h-11 w-full rounded-2xl" />
          <Skeleton className="h-11 w-full rounded-2xl" />
        </div>
      </div>

      <div className={JOURNAL_TAB_RAIL_CLASS}>
        <Skeleton className="h-5 w-[72px] rounded-lg" />
        <Skeleton className="h-5 w-[72px] rounded-lg" />
      </div>

      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="grid grid-cols-1 gap-3 rounded-2xl border border-[#ececf4] bg-white px-4 py-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,1fr)_48px] sm:items-center sm:gap-0 sm:px-6 sm:py-5"
          >
            <Skeleton className="h-5 w-[70%] rounded-lg" />
            <div className="space-y-2 sm:px-10">
              <Skeleton className="h-3 w-[60%] rounded-lg" />
              <Skeleton className="h-4 w-[80%] rounded-lg" />
            </div>
            <div className="space-y-2 sm:px-10">
              <Skeleton className="h-3 w-[45%] rounded-lg" />
              <Skeleton className="h-4 w-[65%] rounded-lg" />
            </div>
            <Skeleton className="size-10 justify-self-end rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
