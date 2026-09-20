import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth";
import { buildMiniAppAuthBootstrapPath } from "@/lib/journal-obligation-links";
import { getServerSession } from "@/lib/server-session";

/**
 * Старый адрес мини-приложения → страница кабинета.
 *
 * Собственных экранов-дублей у приложения больше нет: оно показывает
 * те же страницы сайта в мобильной оболочке (П-3). Сами адреса
 * `/mini/...` оставлены живыми — на них ссылаются кнопки бота, старые
 * сообщения в чатах и закладки на телефонах.
 *
 * Без сессии сначала ведём на вход приложения, а не на `/login` сайта:
 * в Telegram вход происходит сам, по initData, и форма с паролем там
 * выглядит поломкой. Куда человек шёл, запоминаем в `?next=`.
 *
 * Права НЕ проверяем: их проверяет сама страница кабинета, и её
 * проверки местами строже — это и есть требуемое «как на сайте».
 */
export async function redirectToSitePage(
  miniPath: string,
  sitePath: string
): Promise<never> {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session) {
    redirect(buildMiniAppAuthBootstrapPath(miniPath));
  }
  redirect(sitePath);
}

/**
 * Хвост запроса, который понимает страница сайта.
 *
 * Остальные параметры отбрасываем: страница их не читает, а в адресе
 * они выглядят мусором.
 */
export function keepSearchParams(
  params: Record<string, string | string[] | undefined>,
  allowed: readonly string[]
): string {
  const search = new URLSearchParams();
  for (const key of allowed) {
    const value = params[key];
    const single = Array.isArray(value) ? value[0] : value;
    if (typeof single === "string" && single.length > 0) {
      search.set(key, single);
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}
