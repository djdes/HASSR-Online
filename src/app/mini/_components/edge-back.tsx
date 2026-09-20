"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import {
  canStartEdgeBack,
  shouldCommitEdgeBack,
  trackEdgeBack,
} from "@/components/journals/edge-back-gesture";

import { isInsideTelegram } from "./telegram-web-app";
import { isMiniRootPath } from "./mini-shell";
import { haptic } from "./use-haptic";

/**
 * Возврат назад протягиванием от левого края.
 *
 * В Telegram у Mini App системного «назад» нет: жест Safari до
 * приложения не доходит, а кнопка живёт в чужой шапке — через весь
 * экран. Человек тянет от края по привычке и не получает ничего.
 *
 * Включаем ТОЛЬКО внутри Telegram. В обычном мобильном браузере тот же
 * жест принадлежит системе, и перехват увёл бы не назад по приложению,
 * а со страницы целиком — то есть сделал бы ровно противоположное
 * ожидаемому.
 *
 * Подсказка слева — не украшение: без неё непонятно, сколько ещё
 * тянуть, и жест приходится «нащупывать».
 */
export function EdgeBack({ homeHref }: { homeHref: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  // Состояние жеста держим в ref: пересчёт компонента на каждом
  // движении пальца — это и есть тормозящий скролл.
  const gesture = useRef<{
    startX: number;
    startY: number;
    startedAt: number;
    lastX: number;
    progress: number;
  } | null>(null);

  // Корень — домашний адрес кабинета и экран входа: тянуть назад
  // оттуда некуда.
  const isRoot = isMiniRootPath(pathname);

  useEffect(() => {
    if (isRoot) return;
    if (typeof window === "undefined") return;
    // Вне Telegram жест принадлежит системе — не трогаем.
    if (!isInsideTelegram()) return;

    const reset = () => {
      gesture.current = null;
      setProgress(0);
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return reset();
      const touch = event.touches[0];
      if (!canStartEdgeBack({ x: touch.clientX, y: touch.clientY })) return;
      gesture.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startedAt: event.timeStamp,
        lastX: touch.clientX,
        progress: 0,
      };
    };

    const onMove = (event: TouchEvent) => {
      const state = gesture.current;
      if (!state) return;
      const touch = event.touches[0];
      if (!touch) return reset();
      const move = trackEdgeBack(
        { x: state.startX, y: state.startY },
        { x: touch.clientX, y: touch.clientY },
        window.innerWidth
      );
      if (move.kind === "cancel") return reset();
      // Достигнутый порог отмечаем один раз: щелчок на каждом кадре
      // превратился бы в дребезг.
      if (move.progress >= 1 && state.progress < 1) haptic("selection");
      state.lastX = touch.clientX;
      state.progress = move.progress;
      setProgress(move.progress);
    };

    const onEnd = (event: TouchEvent) => {
      const state = gesture.current;
      if (!state) return;
      const elapsed = Math.max(1, event.timeStamp - state.startedAt);
      const velocity = (state.lastX - state.startX) / elapsed;
      const commit = shouldCommitEdgeBack(state.progress, velocity);
      reset();
      if (!commit) return;
      haptic("light");
      if (window.history.length > 1) router.back();
      else router.push(homeHref);
    };

    // Пассивно: жест ничего не отменяет — прокрутку мы и так отдаём
    // через `cancel`, а `preventDefault` здесь стоил бы плавности.
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, [homeHref, isRoot, router]);

  if (isRoot || progress <= 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-r-full"
      style={{
        zIndex: "var(--mini-z-overlay)",
        background: "var(--mini-surface-2)",
        border: "1px solid var(--mini-divider-strong)",
        borderLeft: "none",
        // Панелька выезжает ровно настолько, насколько протянули.
        transform: `translate(${(progress - 1) * 30}px, -50%)`,
        opacity: 0.35 + progress * 0.65,
      }}
    >
      <ChevronLeft
        className="size-6"
        style={{ color: progress >= 1 ? "var(--mini-lime)" : "var(--mini-text-muted)" }}
      />
    </div>
  );
}
