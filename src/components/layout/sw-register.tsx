"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import {
  BUILD_ID_STORAGE_KEY,
  clearBuildCaches,
  fetchServerBuildId,
  readReloadedFor,
  reloadOntoBuild,
} from "@/components/layout/build-reload";
import { buildCheckAction, pageBuildId } from "@/lib/build-version";
import {
  isMiniCacheName,
  isMiniServiceWorkerScope,
} from "@/lib/service-worker-scope";

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

function readStoredBuildId(): string | null {
  try {
    return window.localStorage.getItem(BUILD_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeBuildId(buildId: string) {
  try {
    window.localStorage.setItem(BUILD_ID_STORAGE_KEY, buildId);
  } catch {
    // Приватный режим — уборка кешей просто случится ещё раз.
  }
}

/**
 * Загрузка страницы: страница из старой сборки (вкладку восстановил
 * браузер, HTML отдал старый сервер в момент переключения) — сразу
 * перезагрузка на новую; страница уже новая — только уборка кешей на смене
 * сборки, без лишней перезагрузки (раньше после каждого деплоя первый
 * заход перезагружался ещё раз: сравнивалась не версия страницы, а
 * запомненная в браузере). Решение — `buildCheckAction` (тест).
 */
export function ServiceWorkerRegister() {
  const pathname = usePathname();
  const isFillRoute = FILL_ROUTE_RE.test(pathname ?? "");
  useEffect(() => {
    if (isFillRoute) return;
    let cancelled = false;

    async function syncBuild() {
      await disableLegacyServiceWorkers();

      const serverBuildId = await fetchServerBuildId();
      if (!serverBuildId || cancelled) return;

      const action = buildCheckAction({
        reason: "start",
        pageBuildId: pageBuildId(),
        serverBuildId,
        reloadedFor: readReloadedFor(),
        notified: false,
      });
      if (action === "reload") {
        await reloadOntoBuild(serverBuildId);
        return;
      }

      const previousBuildId = readStoredBuildId();
      if (previousBuildId && previousBuildId !== serverBuildId) {
        // Воркер кабинета держит статику по хешированным именам — без уборки
        // на смене сборки она копилась бы бесконечно. Регистрация остаётся.
        await clearBuildCaches();
      }
      storeBuildId(serverBuildId);
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
