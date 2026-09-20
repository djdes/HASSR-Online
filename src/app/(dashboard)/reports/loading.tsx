import { Skeleton, SkeletonPageHeader } from "@/components/ui/skeleton";

/**
 * Skeleton страницы `/reports`. Повторяет структуру: шапка, карточка
 * ИИ-отчёта, сравнение недель, графики (тренд + heatmap'ы), сводный
 * ZIP-отчёт, форма генерации.
 */
export default function ReportsLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Загружаем отчёты…</span>

      <SkeletonPageHeader />

      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex items-start gap-4">
          <Skeleton className="size-10 shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-48 rounded-lg" />
            <Skeleton className="h-3 w-full rounded-lg" />
            <Skeleton className="h-3 w-4/5 rounded-lg" />
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6">
        <Skeleton className="mb-4 h-4 w-52 rounded-lg" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-[84px] rounded-2xl" />
          <Skeleton className="h-[84px] rounded-2xl" />
        </div>
      </div>

      <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6">
        <Skeleton className="h-4 w-56 rounded-lg" />
        <Skeleton className="mt-1.5 h-3 w-72 max-w-full rounded-lg" />
        <Skeleton className="mt-4 h-[240px] w-full rounded-2xl" />
      </div>

      <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6">
        <Skeleton className="h-4 w-44 rounded-lg" />
        <Skeleton className="mt-1.5 h-3 w-64 max-w-full rounded-lg" />
        <Skeleton className="mt-4 h-[180px] w-full rounded-2xl" />
      </div>

      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
        <div className="flex items-start gap-4">
          <Skeleton className="size-11 shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-[18px] w-56 rounded-lg" />
            <Skeleton className="h-3 w-full rounded-lg" />
          </div>
        </div>
      </div>

      <div className="max-w-lg rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <Skeleton className="h-5 w-44 rounded-lg" />
        <Skeleton className="mt-2 h-3 w-64 max-w-full rounded-lg" />
        <div className="mt-5 space-y-4">
          <Skeleton className="h-11 w-full rounded-2xl" />
          <Skeleton className="h-11 w-full rounded-2xl" />
          <Skeleton className="h-11 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
