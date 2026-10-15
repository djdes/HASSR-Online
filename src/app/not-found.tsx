import { NotFoundCard } from "@/components/layout/not-found-card";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { translatorFor } from "@/i18n/translator";

export async function generateMetadata() {
  const t = await translatorFor(await getSiteLocale());
  return { title: { absolute: `${t("errorSurface.notFoundTitle")} — WeSetup` } };
}

/**
 * Кастомная 404 — без бренд-неловкости от дефолтной английской версии
 * Next.js. Куда вести человека, знает только клиент (кука оболочки),
 * поэтому карточка вынесена в клиентский компонент.
 */
export default function NotFound() {
  return <NotFoundCard />;
}
