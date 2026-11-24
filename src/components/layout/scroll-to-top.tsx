"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isOverlayTransition } from "@/lib/route-overlay";

/**
 * Возврат к началу страницы при переходе между разделами.
 *
 * Next.js App Router на «мягкой» навигации не всегда сбрасывает
 * прокрутку окна: перешёл со середины длинного списка журналов в
 * настройки — и оказываешься не наверху, а где стоял. На телефоне это
 * особенно заметно (владелец: «авторизовался и надо вверх скролить»).
 *
 * Сбрасываем сами при смене пути. Условия:
 * - только по смене `pathname`, а не query: смена вкладки/фильтра в
 *   рамках одной страницы прокрутку трогать не должна;
 * - если в URL есть якорь (`#paper`, `#journal-<code>`), не мешаем
 *   браузеру доскроллить до него;
 * - `auto`, а не `smooth`: на переходе нужен мгновенный верх, а не
 *   заметная анимация проматывания;
 * - окно поверх страницы (пункт ППК, `route-overlay.ts`) прокрутку не
 *   трогает: открыли или закрыли окно — страница под ним стоит, где стояла.
 */
export function ScrollToTop() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const before = previous.current;
    previous.current = pathname;
    if (window.location.hash) return;
    if (isOverlayTransition(before, pathname)) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  return null;
}
