"use client";

/**
 * Общее для `ServiceWorkerRegister` и `BuildVersionWatcher`: как вкладка
 * узнаёт версию сервера и как перезагружается на новую сборку.
 */

import { normalizeBuildId } from "@/lib/build-version";

/** Последняя сборка, которую видела эта вкладка/браузер (для уборки кешей). */
export const BUILD_ID_STORAGE_KEY = "wesetup-build-id";
/** Сборка, ради которой вкладка уже перезагружалась (защита от цикла). */
export const BUILD_RELOAD_FLAG = "wesetup-build-reloaded";

export async function fetchServerBuildId(): Promise<string | null> {
  try {
    const response = await fetch("/api/build-info", { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    return normalizeBuildId(typeof data?.buildId === "string" ? data.buildId : null);
  } catch {
    return null;
  }
}

export function readReloadedFor(): string | null {
  try {
    return window.sessionStorage.getItem(BUILD_RELOAD_FLAG);
  } catch {
    return null;
  }
}

/**
 * Уборка кешей воркера кабинета на смене сборки: он держит статику по
 * хешированным именам, и без уборки она копилась бы бесконечно. Сама
 * регистрация воркера остаётся.
 */
export async function clearBuildCaches(): Promise<void> {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
}

/**
 * Перезагрузиться на сборку `serverBuildId`: уборка кешей, отметка «видели
 * эту сборку» (иначе `ServiceWorkerRegister` после перезагрузки
 * перезагрузил бы ещё раз) и защёлка от цикла.
 */
export async function reloadOntoBuild(serverBuildId: string): Promise<void> {
  try {
    await clearBuildCaches();
  } catch {
    // Кеши не главное — перезагрузка важнее.
  }
  try {
    window.localStorage.setItem(BUILD_ID_STORAGE_KEY, serverBuildId);
    window.sessionStorage.setItem(BUILD_RELOAD_FLAG, serverBuildId);
  } catch {
    // Приватный режим: без защёлки перезагрузка всё равно одна — после
    // неё версия страницы совпадёт с сервером.
  }
  window.location.reload();
}
