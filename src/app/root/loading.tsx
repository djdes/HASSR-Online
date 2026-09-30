import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Загрузка разделов панели платформы (`/root/*`): организации, аудит,
 * обращения — таблицы из базы. Без границы загрузки клик по разделу
 * ничем не отвечал, пока сервер не соберёт страницу целиком.
 */
export default function RootAreaLoading() {
  return <PageSkeleton label="Загружаем раздел…" body="table" actions={false} />;
}
