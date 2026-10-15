
import { useTranslations } from "next-intl";
import { Skeleton, SkeletonPageHeader } from "@/components/ui/skeleton";

/**
 * Skeleton страницы `/journals-progress`. Повторяет структуру
 * `JournalsProgressClient`: шапка + две колонки («Нужно внимание» /
 * «Готовы») со списком строк-журналов.
 */
export default function JournalsProgressLoading() {
  const tLoading = useTranslations("loadingSurfaces");
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{tLoading("journalProgress")}</span>

      <SkeletonPageHeader />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3 rounded-3xl border border-[#ececf4] bg-white p-5 md:p-6 lg:col-span-2">
          <Skeleton className="h-4 w-56 rounded-lg" />
          <Skeleton className="h-3 w-72 max-w-full rounded-lg" />
          <div className="space-y-2 pt-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-[60px] w-full rounded-2xl" />
            ))}
          </div>
        </div>
        <div className="space-y-3 rounded-3xl border border-[#ececf4] bg-white p-5 md:p-6">
          <Skeleton className="h-4 w-32 rounded-lg" />
          <Skeleton className="h-3 w-48 max-w-full rounded-lg" />
          <div className="space-y-2 pt-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-[60px] w-full rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
