"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { isInsideMobileApp } from "@/lib/mobile-app";
import { MINI_SW_SCOPE_PATH } from "@/lib/service-worker-scope";

const MINI_SW_URL = "/mini-sw.js";

/** Снять все регистрации, чей скрипт — воркер кабинета (`/mini-sw.js`). */
async function unregisterMiniServiceWorkers(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) => {
          const worker =
            registration.active ?? registration.waiting ?? registration.installing;
          if (!worker) return false;
          try {
            return new URL(worker.scriptURL).pathname === MINI_SW_URL;
          } catch {
            return false;
          }
        })
        .map((registration) => registration.unregister()),
    );
  } catch (error) {
    console.warn("[mini-sw] не удалось снять регистрацию в приложении", error);
  }
}

/**
 * Один раз за сессию вкладки разрешаем тихо применить обновление. Если
 * после этого воркер всё ещё ждёт — значит тихо не вышло, и дальше
 * спрашиваем человека, а не перезагружаем по кругу.
 */
const SILENT_RELOAD_GUARD = "wesetup.mini.sw-applied";

/**
 * Регистрация service worker'а кабинета.
 *
 * Обновление применяется по-разному в зависимости от того, чем занят
 * человек, и это главное решение здесь:
 *
 *   • обновление УЖЕ ждало, когда приложение открыли — применяем молча
 *     и перезагружаемся. Терять нечего: работа ещё не начата, а тост
 *     вверху свежезапущенного приложения только мешает смотреть на
 *     задачи смены;
 *   • обновление приехало, ПОКА человек внутри — показываем тост и ждём
 *     нажатия. Здесь наоборот: перезагрузка посреди заполнения журнала
 *     стоила бы десяти полей и фото.
 *
 * Автоматического `skipWaiting` в самом воркере нет ни в одном из
 * случаев — команду всегда даёт страница.
 *
 * Живёт только внутри `/mini` и только в этом scope: на сайте воркер не
 * нужен, а лишний scope означал бы перехват страниц дашборда. По той же
 * причине `BuildVersionWatcher` из корневого layout в кабинете молчит —
 * иначе вверху висело бы два одинаковых тоста, и тот, что от него, ещё
 * и врал бы: простая перезагрузка ожидающий воркер не применяет.
 */
export function MiniServiceWorkerRegister() {
  const promptedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // На http (кроме localhost) регистрация всё равно упадёт.
    if (!window.isSecureContext) return;

    // В приложении WeSetup воркер не нужен и вреден: Android WebView
    // приписывает `WeSetupApp/…` к User-Agent запросов самой страницы, но
    // не к запросам из service worker'а. Страница, пришедшая через воркер,
    // попала бы на сервер без метки приложения — и тот показал бы её как
    // браузеру (оплата, без проверки версии, без viewport-fit). Экран
    // «нет сети» у приложения свой. Поэтому не регистрируем, а оставшуюся
    // от прежних версий регистрацию снимаем — без перезагрузки: со
    // следующей загрузки страницы воркер уже не участвует.
    if (isInsideMobileApp()) {
      void unregisterMiniServiceWorkers();
      return;
    }

    let cancelled = false;

    /** Перезагрузиться, когда новый воркер реально возьмёт управление. */
    function reloadOnControllerChange() {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => window.location.reload(),
        { once: true },
      );
    }

    /**
     * Применить молча — но не больше одного раза за сессию вкладки.
     * Возвращает false, если тихий путь недоступен и надо спросить.
     */
    function applySilently(worker: ServiceWorker): boolean {
      try {
        if (window.sessionStorage.getItem(SILENT_RELOAD_GUARD)) return false;
        window.sessionStorage.setItem(SILENT_RELOAD_GUARD, "1");
      } catch {
        // Приватный режим или запрет на данные сайтов: без защёлки
        // тихий путь мог бы зациклить перезагрузку. Спрашиваем.
        return false;
      }
      reloadOnControllerChange();
      worker.postMessage({ type: "SKIP_WAITING" });
      return true;
    }

    /** Показать «Доступно обновление» — один раз на загрузку страницы. */
    function offerUpdate(worker: ServiceWorker) {
      if (promptedRef.current || cancelled) return;
      promptedRef.current = true;
      toast("Доступно обновление", {
        description: "Приложение обновится и страница перезагрузится.",
        duration: Infinity,
        action: {
          label: "Обновить",
          onClick: () => {
            // Перезагружаем не сразу, а когда новый воркер реально взял
            // управление, иначе перезагрузка попадёт на старый и тост
            // вернётся при следующем заходе.
            reloadOnControllerChange();
            worker.postMessage({ type: "SKIP_WAITING" });
          },
        },
      });
    }

    void (async () => {
      try {
        // Scope берём из общего модуля: по нему же корневой
        // `sw-register.tsx` отличает нашу регистрацию от исторических.
        const registration = await navigator.serviceWorker.register(
          MINI_SW_URL,
          { scope: MINI_SW_SCOPE_PATH },
        );
        if (cancelled) return;

        // Обновление уже ждало, когда приложение открыли: человек ещё
        // ничего не набрал, поэтому применяем молча, без баннера.
        if (registration.waiting && navigator.serviceWorker.controller) {
          if (!applySilently(registration.waiting)) {
            offerUpdate(registration.waiting);
          }
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // `controller` пуст при самой первой установке — тогда
            // обновлять нечего, человек и так видит свежую версию.
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              offerUpdate(installing);
            }
          });
        });
      } catch (error) {
        // Тихо: без воркера кабинет работает, просто не устанавливается.
        console.warn("[mini-sw] регистрация не удалась", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
