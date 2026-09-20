"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { haptic } from "./use-haptic";
import { isPullGesture } from "../_lib/scroll-direction";

/**
 * Pull-to-refresh для Mini App.
 *
 * Когда пользователь свайпает вниз от верха страницы (`scrollTop === 0`) на
 * >= 64 px, вызывается `onRefresh()`. Пока promise не завершится, шапка
 * показывает крутящийся индикатор. Логика чисто touch-based — на десктопе
 * эффекта не будет (mouse wheel не триггерит). Это намеренно: pull-to-refresh
 * — мобильный паттерн, на десктопе у пользователя есть Ctrl+R.
 *
 * Не блокирует естественный скролл: пока scrollTop > 0, gesture-handler
 * молчит. Только когда страница уже наверху и палец продолжает тянуть вниз —
 * мы перехватываем и переводим жест в индикатор.
 */
const ACTIVATION_THRESHOLD = 64;
const MAX_PULL = 120;

type PullPhase = "idle" | "pulling" | "armed" | "refreshing";

export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [phase, setPhase] = useState<PullPhase>("idle");
  const [pull, setPull] = useState(0);
  const startY = useRef<number | null>(null);
  const startX = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Phase в ref'е — нужен в onTouchEnd, чтобы решать, активирован ли
  // pull. Раньше эффект перевешивал слушатели на каждое изменение
  // `phase` (deps: [onRefresh, phase, reset]) — листенеры свапались
  // mid-touch, и в редких race'ах onTouchEnd видел stale phase.
  const phaseRef = useRef<PullPhase>("idle");
  // onRefresh в ref'е — чтобы effect не пере-bind'ил листенеры на
  // каждый новый rendering callback'а с другим reference.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const reset = useCallback(() => {
    phaseRef.current = "idle";
    setPhase("idle");
    setPull(0);
    startY.current = null;
    startX.current = null;
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    function onTouchStart(e: TouchEvent) {
      if (window.scrollY > 4) return;
      const t = e.touches[0];
      if (!t) return;
      startY.current = t.clientY;
      startX.current = t.clientX;
      phaseRef.current = "pulling";
      setPhase("pulling");
    }

    function onTouchMove(e: TouchEvent) {
      if (startY.current === null) return;
      const t = e.touches[0];
      if (!t) return;
      const delta = t.clientY - startY.current;
      const sideways = t.clientX - (startX.current ?? t.clientX);
      // Жест стоит на всех экранах, а среди них есть таблица
      // документа, которую водят вбок. Без этой проверки обновление
      // перехватывало бы горизонтальную прокрутку.
      if (delta <= 0 || !isPullGesture(sideways, delta)) {
        reset();
        return;
      }
      const damped = Math.min(MAX_PULL, delta * 0.55);
      setPull(damped);
      const next: PullPhase = damped >= ACTIVATION_THRESHOLD ? "armed" : "pulling";
      // Щелчок ровно в момент взвода: без него непонятно, дотянул ли
      // до порога, и лист тянут с запасом до упора.
      if (next === "armed" && phaseRef.current !== "armed") haptic("selection");
      phaseRef.current = next;
      setPhase(next);
      if (delta > 4 && e.cancelable) e.preventDefault();
    }

    async function onTouchEnd() {
      // Читаем из ref'ы — гарантия консистентности с последним
      // onTouchMove, без race'а с stale closure.
      if (phaseRef.current !== "armed") {
        reset();
        return;
      }
      phaseRef.current = "refreshing";
      setPhase("refreshing");
      try {
        await onRefreshRef.current();
      } finally {
        phaseRef.current = "idle";
        setPull(0);
        setPhase("idle");
        startY.current = null;
      }
    }

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd);
    node.addEventListener("touchcancel", reset);
    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", reset);
    };
    // ⚠️ deps умышленно [reset] — без `phase` и `onRefresh`. См. JSDoc выше.
  }, [reset]);

  const indicatorOpacity = Math.min(1, pull / ACTIVATION_THRESHOLD);
  const isActive = phase === "armed" || phase === "refreshing";

  // На сколько сдвинуто содержимое. В покое — ноль, и тогда у обёртки
  // НЕ должно остаться ни `transform`, ни `will-change`.
  const offset = phase === "refreshing" ? 36 : pull;

  /**
   * ⚠️ Почему в покое обёртка обязана быть без `transform`.
   *
   * Элемент с ненулевым (и даже нулевым!) `transform` становится
   * containing block для всех потомков с `position: fixed`. Обёртка
   * стоит между `<main>` и содержимым страницы, то есть выше любого
   * окна кабинета, которое рисуется не порталом в `body`, а прямо в
   * разметке страницы (`fixed inset-0 …`). Пока здесь всегда висел
   * `translateY(0px)`, такие окна мерились не от экрана, а от высоты
   * всей страницы: на 360×640 «Пригласить по QR» открывалось высотой
   * в три тысячи пикселей, карточка уезжала на два экрана вниз, а
   * прокрутки не было — окно блокирует скролл страницы.
   *
   * Поэтому transform живёт ровно столько, сколько идёт жест плюс
   * время обратной анимации, после чего снимается совсем.
   */
  const [settling, setSettling] = useState(false);
  const wasShifted = useRef(false);
  useEffect(() => {
    if (offset > 0) {
      wasShifted.current = true;
      setSettling(false);
      return;
    }
    if (!wasShifted.current) return;
    wasShifted.current = false;
    setSettling(true);
    const timer = window.setTimeout(() => setSettling(false), 300);
    return () => window.clearTimeout(timer);
  }, [offset]);

  const shifted = offset > 0 || settling;

  return (
    // Обёртки обязаны быть колонкой с flex-1: теперь они стоят между
    // `<main>` и любым экраном, а экраны тянутся через `flex-1`.
    // Без этого цепочка рвётся и центрированные состояния (спиннер,
    // скелетон) схлопываются к верху экрана.
    <div ref={containerRef} className="relative flex min-h-0 flex-1 flex-col">
      {/* Indicator — sticky над контентом, появляется по мере pull. */}
      <div
        className="pointer-events-none absolute left-0 right-0 top-0 flex justify-center"
        style={{
          transform: `translateY(${
            phase === "refreshing" ? 16 : Math.max(0, pull - 28)
          }px)`,
          opacity: phase === "refreshing" ? 1 : indicatorOpacity,
          transition: phase === "refreshing" ? "transform 0.2s ease" : undefined,
        }}
      >
        <div
          className="flex size-8 items-center justify-center rounded-full"
          style={{
            background: "var(--mini-surface-1)",
            border: "1px solid var(--mini-divider-strong)",
            color: isActive ? "var(--mini-lime)" : "var(--mini-text-muted)",
          }}
        >
          <Loader2
            className={`size-4 ${phase === "refreshing" ? "animate-spin" : ""}`}
          />
        </div>
      </div>

      {/* Контент сдвигается вниз ровно на pull, чтобы индикатор был
          визуально «отделён» от хедера и не накрывал текст.
          В покое — вообще без `style`: см. комментарий к `shifted`. */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={
          shifted
            ? {
                transform: `translateY(${offset}px)`,
                transition:
                  phase === "idle" || phase === "refreshing"
                    ? "transform 0.25s ease"
                    : undefined,
              }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
