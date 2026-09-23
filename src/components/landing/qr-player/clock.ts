"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Часы кадров — та же модель, что у Remotion: ролик — это чистая функция
 * номера кадра. Часы только двигают номер (requestAnimationFrame), а всё,
 * что видно в кадре, считается из него. Поэтому перемотка детерминирована:
 * кадр 210 всегда выглядит одинаково, как бы зритель до него ни дошёл.
 */

export type Easing = (t: number) => number;

export const ease = {
  linear: ((t) => t) as Easing,
  out: ((t) => 1 - Math.pow(1 - t, 3)) as Easing,
  inOut: ((t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)) as Easing,
  /** Лёгкий «перелёт» — для появления карточек. */
  outBack: ((t) => {
    const c1 = 1.4;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }) as Easing,
};

/**
 * `interpolate(frame, [30, 45], [0, 1])` — как в Remotion: линейное
 * отображение отрезка входа на отрезок выхода, по умолчанию с зажимом
 * по краям и с необязательной функцией сглаживания.
 */
export function interpolate(
  input: number,
  [inFrom, inTo]: readonly [number, number],
  [outFrom, outTo]: readonly [number, number],
  options: { easing?: Easing; clamp?: boolean } = {}
): number {
  const { easing = ease.linear, clamp = true } = options;
  if (inTo === inFrom) return input < inFrom ? outFrom : outTo;
  let t = (input - inFrom) / (inTo - inFrom);
  if (clamp) t = Math.min(1, Math.max(0, t));
  return outFrom + (outTo - outFrom) * easing(t);
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

export type PlayerClock = {
  frame: number;
  /** Зритель хочет, чтобы ролик шёл (пауза вне экрана это не сбрасывает). */
  playing: boolean;
  /** Ролик реально идёт сейчас. */
  running: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (frame: number) => void;
};

export function usePlayerClock(params: {
  fps: number;
  durationInFrames: number;
  /** Можно ли идти: в зоне видимости и вкладка на экране. */
  active: boolean;
  initialFrame?: number;
}): PlayerClock {
  const { fps, durationInFrames, active } = params;
  const [frame, setFrame] = useState(params.initialFrame ?? 0);
  const [playing, setPlaying] = useState(false);
  // Номер перемотки: после seek часы берут новую точку отсчёта.
  const [epoch, setEpoch] = useState(0);
  const frameRef = useRef(frame);
  const running = playing && active;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let startTime: number | null = null;
    const startFrame = frameRef.current;
    const tick = (now: number) => {
      if (startTime === null) startTime = now;
      const next = Math.floor(startFrame + ((now - startTime) / 1000) * fps) % durationInFrames;
      if (next !== frameRef.current) {
        frameRef.current = next;
        setFrame(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, fps, durationInFrames, epoch]);

  const seek = useCallback(
    (target: number) => {
      const next = ((Math.round(target) % durationInFrames) + durationInFrames) % durationInFrames;
      frameRef.current = next;
      setFrame(next);
      setEpoch((value) => value + 1);
    },
    [durationInFrames]
  );

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying((value) => !value), []);

  return { frame, playing, running, play, pause, toggle, seek };
}
