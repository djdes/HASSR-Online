import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Экран-заглушка «раздел только в полной версии» больше не нужен: все
 * разделы кабинета открываются прямо в приложении (П-3). Старые ссылки
 * ведём в «Все разделы».
 */
export default async function MiniOpenRedirectPage() {
  redirect("/mini/sections");
}
