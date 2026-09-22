"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Живое значение медиазапроса: меняется вместе с окном и настройками
 * системы, без перезагрузки страницы.
 *
 * Та же идея, что у `use-narrow-viewport.ts`, но на
 * `useSyncExternalStore`: на сервере и в кадре гидрации значение
 * `false` (сервер экрана не знает), а сразу после React сам
 * перерисовывает с настоящим — без расхождения разметки и без
 * setState в эффекте.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** Мышь или тачпад: есть наведение и точный указатель. */
export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

/** Человек попросил систему убрать анимации. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Точный указатель (мышь). На телефоне — `false`: там, например, нельзя
 * ставить фокус в поле само собой, иначе выезжает клавиатура и
 * закрывает половину списка.
 */
export function useFinePointer(): boolean {
  return useMediaQuery(FINE_POINTER_QUERY);
}

/** Анимации выключены в системе — движение делаем мгновенным. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}
