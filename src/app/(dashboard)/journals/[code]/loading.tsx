import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton списка документов внутри журнала (`/journals/[code]`).
 * Повторяет `JournalTopBar` (заголовок + блок кнопок `JournalListActions`:
 * «QR-точка контроля» во всю ширину над рядом «Создать документ |
 * Инструкция»), `JournalTabs` («Активные / Закрытые») и карточки документов.
 */
export default function JournalCodeLoading() {
  return (
    <div className="space-y-5 sm:space-y-14" aria-busy="true" aria-live="polite">
      <span className="sr-only">Загружаем документы журнала…</span>

      <div className="flex flex-wrap items-start justify-between gap-4 sm:items-center">
        <Skeleton className="h-9 w-[320px] max-w-full rounded-2xl" />
        <div className="grid w-full grid-cols-2 gap-2 sm:w-[440px] sm:shrink-0">
          <Skeleton className="col-span-2 h-12 w-full rounded-2xl" />
          <Skeleton className="h-11 w-full rounded-2xl" />
          <Skeleton className="h-11 w-full rounded-2xl" />
        </div>
      </div>

      <div className="border-b border-[#ececf4] pb-5">
        <div className="flex gap-8 sm:gap-12">
          <Skeleton className="h-5 w-[90px] rounded-lg" />
          <Skeleton className="h-5 w-[90px] rounded-lg" />
        </div>
      </div>

      <div className="space-y-4 sm:space-y-6">
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
