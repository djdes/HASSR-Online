import { PageSkeleton } from "@/components/ui/skeleton";

/** Загрузка `/bonuses`: шапка и список начислений (страница считает бонусы по журналам). */
export default function BonusesLoading() {
  return <PageSkeleton label="Загружаем бонусы…" body="list" />;
}
