"use client";

import { useEffect, useState, type RefObject } from "react";
import { Easing as RemotionEasing, interpolate as remotionInterpolate } from "remotion";

/**
 * Тайминги ролика — на движке Remotion: `interpolate` и `Easing` берутся
 * из пакета `remotion`. Локальная обёртка сохраняет прежнюю сигнатуру
 * (`{ clamp }` вместо `extrapolateLeft/Right`) и допускает пустой входной
 * отрезок, который Remotion считает ошибкой. Сам номер кадра двигает
 * `<Player>` из `@remotion/player` (см. qr-player.tsx): ролик остаётся
 * чистой функцией кадра, перемотка детерминирована — кадр 210 всегда
 * выглядит одинаково, как бы зритель до него ни дошёл.
 */

export type Easing = (t: number) => number;

export const ease = {
  linear: RemotionEasing.linear as Easing,
  out: RemotionEasing.out(RemotionEasing.cubic) as Easing,
  inOut: RemotionEasing.inOut(RemotionEasing.cubic) as Easing,
  /** Лёгкий «перелёт» — для появления карточек. Easing.back(1.4) в
      out-обёртке алгебраически совпадает с прежней формулой (c3 = c1+1). */
  outBack: RemotionEasing.out(RemotionEasing.back(1.4)) as Easing,
};

/**
 * `interpolate(frame, [30, 45], [0, 1])` — линейное отображение отрезка
 * входа на отрезок выхода, по умолчанию с зажимом по краям и с
 * необязательной функцией сглаживания. Внутри — remotion.interpolate.
 */
export function interpolate(
  input: number,
  [inFrom, inTo]: readonly [number, number],
  [outFrom, outTo]: readonly [number, number],
  options: { easing?: Easing; clamp?: boolean } = {}
): number {
  const { easing = ease.linear, clamp = true } = options;
  if (inTo === inFrom) return input < inFrom ? outFrom : outTo;
  const extrapolate = clamp ? ("clamp" as const) : ("extend" as const);
  return remotionInterpolate(input, [inFrom, inTo], [outFrom, outTo], {
    easing,
    extrapolateLeft: extrapolate,
    extrapolateRight: extrapolate,
  });
}

/** 0 → 1 на отрезке [from, from + duration] (в секундах сцены). */
export function progress(t: number, from: number, duration: number, easing: Easing = ease.out): number {
  return interpolate(t, [from, from + duration], [0, 1], { easing });
}

/** Появление и исчезновение: 0 → 1 → 0 по краям окна [from, to]. */
export function windowed(t: number, from: number, to: number, fade = 0.25): number {
  if (t < from || t > to) return 0;
  return Math.min(progress(t, from, fade), 1 - progress(t, to - fade, fade, ease.inOut));
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Секция в зоне видимости и вкладка не скрыта. Вне экрана и на фоновой
 * вкладке ролик стоит: не тратит батарею и не «убегает» от зрителя.
 */
export function useOnScreen(ref: RefObject<HTMLElement | null>, threshold = 0.35): boolean {
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(entry.isIntersecting);
      },
      { threshold }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, threshold]);

  useEffect(() => {
    const sync = () => setPageVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return inView && pageVisible;
}
