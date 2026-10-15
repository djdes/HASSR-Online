
import { useTranslations } from "next-intl";
import { Skeleton, SkeletonPageHeader } from "@/components/ui/skeleton";

/**
 * Skeleton страницы `/control-board`. Повторяет структуру
 * `ControlBoardClient`: шапка, плитки статусов, строка фильтров,
 * группы карточек задач.
 */
export default function ControlBoardLoading() {
  const tLoading = useTranslations("loadingSurfaces");
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{tLoading("controlBoard")}</span>

      <SkeletonPageHeader />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-[62px] rounded-2xl" />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#ececf4] bg-white px-3 py-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-24 rounded-full" />
        ))}
      </div>

      {Array.from({ length: 2 }).map((_, groupIndex) => (
        <section key={groupIndex} className="space-y-2">
          <Skeleton className="h-3 w-36 rounded-lg" />
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, cardIndex) => (
              <div
                key={cardIndex}
                className="rounded-2xl border border-[#ececf4] bg-white p-3"
              >
                <div className="flex items-start gap-2">
                  <Skeleton className="size-8 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-full rounded-lg" />
                    <Skeleton className="h-3 w-2/3 rounded-lg" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
