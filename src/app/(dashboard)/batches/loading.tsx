import { PageSkeleton } from "@/components/ui/skeleton";

/** Загрузка `/batches/*`: шапка и таблица партий (страница читает несколько списков из базы). */
export default function BatchesLoading() {
  return <PageSkeleton label="Загружаем партии…" body="table" />;
}
