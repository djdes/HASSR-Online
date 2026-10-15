
import { useTranslations } from "next-intl";
import { Skeleton, SkeletonPageHeader } from "@/components/ui/skeleton";

/**
 * Skeleton страницы `/team`. Повторяет структуру `TeamClient`: шапка
 * + группы карточек сотрудников (иконка-статус, имя, должность, пилюля
 * статуса).
 */
export default function TeamLoading() {
  const tLoading = useTranslations("loadingSurfaces");
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{tLoading("team")}</span>

      <SkeletonPageHeader />

      {Array.from({ length: 2 }).map((_, groupIndex) => (
        <section key={groupIndex} className="space-y-2">
          <Skeleton className="h-3 w-40 rounded-lg" />
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, cardIndex) => (
              <div
                key={cardIndex}
                className="rounded-3xl border border-[#ececf4] bg-white p-4"
              >
                <div className="flex items-start gap-3">
                  <Skeleton className="size-10 shrink-0 rounded-2xl" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3 rounded-lg" />
                    <Skeleton className="h-3 w-1/2 rounded-lg" />
                    <Skeleton className="h-5 w-24 rounded-full" />
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
