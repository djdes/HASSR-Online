import { getTranslations } from "next-intl/server";
import { PageSkeleton } from "@/components/ui/skeleton";

/** Загрузка `/losses/*`: шапка и таблица потерь (страница читает несколько списков из базы). */
export default async function LossesLoading() {
  const t = await getTranslations("productionLosses");
  return <PageSkeleton label={t("loading")} body="table" />;
}
