import { platformEntryHref } from "@/lib/platform-access";
import { relativeRedirect } from "@/lib/relative-redirect";

export const dynamic = "force-dynamic";

/**
 * Редактор переводов — вкладка «Переводы» панели платформы (владелец,
 * 2026-11-09). Старый адрес кабинета ведёт туда же: вход в панель обновит
 * разделы в сессии и откроет вкладку, если она человеку доступна.
 */
export function GET() {
  return relativeRedirect(platformEntryHref("/root/translations"));
}
