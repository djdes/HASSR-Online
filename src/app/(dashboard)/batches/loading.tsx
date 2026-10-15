import { getTranslations } from "next-intl/server";
import { PageSkeleton } from "@/components/ui/skeleton";

/** Загрузка `/batches/*`: шапка и таблица партий (страница читает несколько списков из базы). */
export default async function BatchesLoading() {
  const t = await getTranslations("productionBatches");
  return <PageSkeleton label={t("loading")} body="table" />;
}
