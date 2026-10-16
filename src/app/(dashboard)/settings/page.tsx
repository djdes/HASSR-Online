import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";

export const dynamic = "force-dynamic";

/**
 * Хаба настроек больше нет (меню кабинета 2026-10-16): каждая настройка
 * живёт в своём разделе слева — права у «Сотрудников», набор журналов у
 * «Журналов», тариф в «Оплате», интеграции в «Остальном». Адрес
 * `/settings` остаётся: на него ведут старые ссылки и редиректы страниц
 * настроек, — и отправляет туда, где человеку есть что делать.
 */
export default async function SettingsPage() {
  const session = await requireAuth();
  if (hasCapability(session.user, "admin.full")) redirect("/settings/organization");
  if (hasCapability(session.user, "tasks.verify")) redirect("/control-board");
  redirect("/journals");
}
