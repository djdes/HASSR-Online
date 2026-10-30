import { AccessDenied } from "@/components/layout/access-denied";

/**
 * «Нет доступа» внутри кабинета (2026-10-29): страница вызвала `forbidden()`
 * (раздел закрыт для роли), а меню и шапка остаются на месте — человек видит,
 * почему не пустили, и выбирает раздел в меню. Раньше такие страницы молча
 * уводили в «Журналы» или на «Сегодня». Тот же экран — в оболочке Mini App.
 */
export default function DashboardForbidden() {
  return <AccessDenied kind="forbidden" />;
}
