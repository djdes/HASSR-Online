"use client";

import { getSession } from "next-auth/react";
import { rereadClientSession } from "@/lib/client-session-sync";

/**
 * Подхват cookie-сессии в Mini App без Telegram.
 *
 * `MiniSessionProvider` стартует с `session={null}`, и next-auth v4 при
 * заданном (пусть пустом) session сервер не спрашивает: `status` навсегда
 * «unauthenticated», хотя кука живая — вход по телефону, установленное
 * приложение, прямая ссылка на /mini/me. Спрашиваем сами.
 *
 * Одного `getSession()` мало: «broadcast» у next-auth — это запись в
 * localStorage под ключом `nextauth.message` и слушатель события
 * `storage`, которое браузер шлёт только ДРУГИМ вкладкам. Поэтому после
 * ответа сервера отправляем такое же событие в свою вкладку — провайдер
 * разбирает его как сообщение из соседней вкладки, перечитывает сессию,
 * и `status` становится «authenticated».
 *
 * Один запрос на вкладку: провайдер и главная зовут это одновременно.
 */
let inflight: Promise<boolean> | null = null;

export function adoptCookieSession(): Promise<boolean> {
  if (inflight) return inflight;
  inflight = (async () => {
    const existing = await getSession().catch(() => null);
    if (!existing?.user) return false;
    // Провайдер перечитает сессию (`lib/client-session-sync.ts`); нет
    // StorageEvent — страница сама решит, что делать по таймауту.
    rereadClientSession();
    return true;
  })();
  // Следующий холодный старт в этой же вкладке (после выхода) должен
  // спросить заново.
  void inflight.finally(() => {
    window.setTimeout(() => {
      inflight = null;
    }, 5000);
  });
  return inflight;
}
