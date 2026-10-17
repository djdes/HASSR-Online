import { redirect } from "next/navigation";

/**
 * Бывшая вкладка «Настройка» раздела «Сотрудники». С 2026-10-17 у раздела
 * своё левое меню, и все её карточки (права, иерархия, нагрузка, телефон…)
 * стали его пунктами. Старые ссылки и закладки ведут к сотрудникам.
 */
export default function StaffSettingsSectionPage() {
  redirect("/settings/users");
}
