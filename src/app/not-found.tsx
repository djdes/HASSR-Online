import { NotFoundCard } from "@/components/layout/not-found-card";

export const metadata = {
  // title.absolute обходит layout's "%s — WeSetup" template — иначе
  // получается "Страница не найдена — WeSetup — WeSetup".
  title: { absolute: "Страница не найдена — WeSetup" },
};

/**
 * Кастомная 404 — без бренд-неловкости от дефолтной английской версии
 * Next.js. Куда вести человека, знает только клиент (кука оболочки),
 * поэтому карточка вынесена в клиентский компонент.
 */
export default function NotFound() {
  return <NotFoundCard />;
}
