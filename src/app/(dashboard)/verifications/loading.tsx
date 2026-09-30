import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Skeleton страницы `/verifications`: шапка и список карточек задач.
 * Этот же скелет показывает `VerificationsClient`, пока грузит задачи, —
 * серверный скелет сменяется клиентским незаметно.
 */
export default function VerificationsLoading() {
  return <PageSkeleton label="Загружаем задачи на проверку…" body="list" actions={false} />;
}
