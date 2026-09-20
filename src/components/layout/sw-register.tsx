"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import {
  isMiniCacheName,
  isMiniServiceWorkerScope,
} from "@/lib/service-worker-scope";

const BUILD_ID_STORAGE_KEY = "wesetup-build-id";
const BUILD_RELOAD_FLAG = "wesetup-build-reloaded";

/**
 * Снос исторических воркеров.
 *
 * Воркер кабинета (`/mini-sw.js`, scope `/mini`) — НЕ исторический, его
 * трогать нельзя. Компонент висит в корневом layout, то есть работает и
 * на страницах `/mini`: без этой проверки он снимал бы регистрацию
 * кабинета при каждом заходе, и приложение не устанавливалось бы. Хуже
 * того — невоспроизводимо: у того, кто заходит только в кабинет, всё
 * работало бы. Условие проверено тестом (`service-worker-scope.test.ts`).
 */
async function disableLegacyServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) => !isMiniServiceWorkerScope(registration.scope))
      .map((registration) => registration.unregister()),
  );

  if ("caches" in window) {
    const cacheKeys = await caches.keys();
    await Promise.all(
      cacheKeys.filter((key) => !isMiniCacheName(key)).map((key) => caches.delete(key)),
    );
  }
}

/** Публичные QR-формы: без проверки сборки и воркеров — меньше работы на слабом телефоне. */
const FILL_ROUTE_RE = /^\/(journal-fill|equipment-fill|room-fill|task-fill)(\/|$)/;

export function ServiceWorkerRegister() {
  const pathname = usePathname();
  const isFillRoute = FILL_ROUTE_RE.test(pathname ?? "");
  useEffect(() => {
    if (isFillRoute) return;
    let cancelled = false;

    async function syncBuild() {
      await disableLegacyServiceWorkers();

      const response = await fetch("/api/build-info", { cache: "no-store" });
      if (!response.ok || cancelled) return;

      const data = await response.json();
      const nextBuildId = typeof data?.buildId === "string" ? data.buildId : "";
      if (!nextBuildId || cancelled) return;

      const previousBuildId = window.localStorage.getItem(BUILD_ID_STORAGE_KEY);
      const reloadFlag = window.sessionStorage.getItem(BUILD_RELOAD_FLAG);

      if (previousBuildId && previousBuildId !== nextBuildId && reloadFlag !== nextBuildId) {
        // Здесь кеши кабинета чистятся НАМЕРЕННО, в отличие от
        // `disableLegacyServiceWorkers`: воркер держит статику по
        // хешированным именам, и без уборки на смене сборки она копилась
        // бы бесконечно. Сама регистрация при этом остаётся.
        if ("caches" in window) {
          const cacheKeys = await caches.keys();
          await Promise.all(cacheKeys.map((key) => caches.delete(key)));
        }

        window.localStorage.setItem(BUILD_ID_STORAGE_KEY, nextBuildId);
        window.sessionStorage.setItem(BUILD_RELOAD_FLAG, nextBuildId);
        window.location.reload();
        return;
      }

      window.localStorage.setItem(BUILD_ID_STORAGE_KEY, nextBuildId);
      if (reloadFlag === nextBuildId) {
        window.sessionStorage.removeItem(BUILD_RELOAD_FLAG);
      }
    }

    syncBuild().catch((error) => {
      console.error("Failed to sync build state:", error);
    });

    return () => {
      cancelled = true;
    };
  }, [isFillRoute]);

  return null;
}
