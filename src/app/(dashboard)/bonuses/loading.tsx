
import { useTranslations } from "next-intl";
import { PageSkeleton } from "@/components/ui/skeleton";

/** Загрузка `/bonuses`: шапка и список начислений (страница считает бонусы по журналам). */
export default function BonusesLoading() {
  const tLoading = useTranslations("loadingSurfaces");
  return <PageSkeleton label={tLoading("bonuses")} body="list" />;
}
