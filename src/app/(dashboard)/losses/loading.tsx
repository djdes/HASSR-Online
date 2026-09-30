import { PageSkeleton } from "@/components/ui/skeleton";

/** Загрузка `/losses/*`: шапка и таблица потерь (страница читает несколько списков из базы). */
export default function LossesLoading() {
  return <PageSkeleton label="Загружаем потери…" body="table" />;
}
