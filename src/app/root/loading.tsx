
import { useTranslations } from "next-intl";
import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Загрузка разделов панели платформы (`/root/*`): организации, аудит,
 * обращения — таблицы из базы. Без границы загрузки клик по разделу
 * ничем не отвечал, пока сервер не соберёт страницу целиком.
 */
export default function RootAreaLoading() {
  const tLoading = useTranslations("loadingSurfaces");
  return <PageSkeleton label={tLoading("section")} body="table" actions={false} />;
}
