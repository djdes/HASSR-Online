import { redirectToSitePage } from "../_lib/site-redirect";

export const dynamic = "force-dynamic";

/**
 * Оборудование ведётся в кабинете.
 *
 * Поиск `?q=` не пробрасываем: страница кабинета такого параметра не
 * читает, и он остался бы в адресе мусором.
 */
export default async function MiniEquipmentRedirectPage() {
  await redirectToSitePage("/mini/equipment", "/settings/equipment");
}
