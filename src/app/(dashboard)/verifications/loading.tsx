
import { useTranslations } from "next-intl";
import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Skeleton страницы `/verifications`: шапка и список карточек задач.
 * Этот же скелет показывает `VerificationsClient`, пока грузит задачи, —
 * серверный скелет сменяется клиентским незаметно.
 */
export default function VerificationsLoading() {
  const tLoading = useTranslations("loadingSurfaces");
  return <PageSkeleton label={tLoading("verifications")} body="list" actions={false} />;
}
