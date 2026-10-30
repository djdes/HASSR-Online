import { AccessDenied } from "@/components/layout/access-denied";

/**
 * «Такой страницы нет» внутри кабинета (2026-10-29): `notFound()` страницы
 * или неизвестный адрес раздела (ловушки `<раздел>/[...missing]`). Раньше —
 * корневой 404 без меню и шапки: человек выпадал из кабинета.
 */
export default function DashboardNotFound() {
  return <AccessDenied kind="notFound" />;
}
