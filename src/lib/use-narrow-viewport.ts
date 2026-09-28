"use client";

import { useSyncExternalStore } from "react";

/**
 * `true` на телефоне (< 640px).
 *
 * Жил внутри `spotlight-tour.tsx` — компонента обучающего тура, — и это
 * заставляло пять других файлов, к туру отношения не имеющих, тянуть
 * весь тур ради двух строк. Здесь же ему и место.
 */
const NARROW_QUERY = "(max-width: 639px)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Гидратация идёт по серверному значению (`false`), потом React сам
 * перерисует по экрану. Раньше экран читался уже в первом рендере: на
 * телефоне разметка клиента расходилась с серверной, и React оставлял
 * серверные атрибуты (кнопка партнёрской программы в шапке мини-приложения
 * жила с атрибутами всплывающего окна, которого на телефоне нет).
 */
export function useIsNarrowViewport(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false
  );
}
