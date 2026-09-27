"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";

import {
  fetchServerBuildId,
  readReloadedFor,
  reloadOntoBuild,
} from "@/components/layout/build-reload";
import {
  BUILD_POLL_MS,
  buildCheckAction,
  pageBuildId,
  shouldCheckBuild,
  type BuildCheckReason,
} from "@/lib/build-version";

/**
 * Вотчер версии сборки в уже открытой вкладке.
 *
 * Сравнивает версию, из которой собрана страница (`pageBuildId()`), с той,
 * что сейчас обслуживает сайт (`/api/build-info`). Спрашивает сервер:
 *   • раз в 5 минут;
 *   • при возврате во вкладку (`visibilitychange`, `focus`) и при
 *     восстановлении страницы из кеша браузера (`pageshow`) — раньше вкладка,
 *     открытая вчера, показывала вчерашнее меню, пока не сработает опрос;
 *   • при переходе на другую страницу сайта.
 * Устарела при переходе — сразу перезагрузка (на новой странице ещё ничего
 * не введено); в остальных случаях — несъезжающая плашка «Обновить»:
 * человек сам выбирает момент и не теряет введённое. Что именно делать —
 * `buildCheckAction` (тест `build-version.test.ts`). Загрузку страницы
 * проверяет `ServiceWorkerRegister`.
 *
 * В кабинете (`/mini`) НЕ работает. Компонент висит в корневом layout, а
 * у кабинета есть свой сообщатель об обновлении
 * (`app/mini/_components/mini-sw-register.tsx`), и вместе они показывали
 * ДВА одинаковых несъезжающих тоста «Доступно обновление» вверху экрана
 * телефона — один поверх другого. Побеждает тот, что в кабинете: он не
 * только перезагружает страницу, но и применяет ожидающий service worker.
 */
export function BuildVersionWatcher() {
  const pathname = usePathname();
  const inMiniApp = pathname === "/mini" || pathname.startsWith("/mini/");
  // На публичных QR-формах опрос сборки не нужен: форму открывают на минуту.
  const inFillRoute = /^\/(journal-fill|equipment-fill|room-fill|task-fill)(\/|$)/.test(pathname);
  const active = !inMiniApp && !inFillRoute;

  const lastCheckAt = useRef(0);
  const checking = useRef(false);
  const notified = useRef(false);
  /** Сервер уже на новой сборке — следующий переход перезагрузит без запроса. */
  const newerBuildId = useRef<string | null>(null);
  const seenPathname = useRef<string | null>(null);

  const check = useCallback(async (reason: BuildCheckReason) => {
    const now = Date.now();
    if (checking.current || !shouldCheckBuild(reason, now, lastCheckAt.current)) return;
    checking.current = true;
    lastCheckAt.current = now;
    try {
      const serverBuildId = await fetchServerBuildId();
      if (!serverBuildId) return;
      if (serverBuildId !== pageBuildId()) newerBuildId.current = serverBuildId;
      const action = buildCheckAction({
        reason,
        pageBuildId: pageBuildId(),
        serverBuildId,
        reloadedFor: readReloadedFor(),
        notified: notified.current,
      });
      if (action === "reload") {
        await reloadOntoBuild(serverBuildId);
        return;
      }
      if (action === "notify") {
        notified.current = true;
        toast.message("Сайт обновился", {
          description: "Обновите страницу, чтобы увидеть последние изменения.",
          duration: Infinity,
          action: {
            label: "Обновить",
            onClick: () => void reloadOntoBuild(serverBuildId),
          },
        });
      }
    } finally {
      checking.current = false;
    }
  }, []);

  // Опрос и возврат во вкладку.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void check("poll"), BUILD_POLL_MS);
    const onReturn = () => {
      if (document.visibilityState === "visible") void check("return");
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void check("return");
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [active, check]);

  // Переход на другую страницу сайта (первую отрисовку проверяет ServiceWorkerRegister).
  useEffect(() => {
    if (!active) return;
    if (seenPathname.current === null) {
      seenPathname.current = pathname;
      return;
    }
    if (seenPathname.current === pathname) return;
    seenPathname.current = pathname;
    const newer = newerBuildId.current;
    if (newer && readReloadedFor() !== newer) {
      void reloadOntoBuild(newer);
      return;
    }
    void check("navigation");
  }, [pathname, active, check]);

  return null;
}
