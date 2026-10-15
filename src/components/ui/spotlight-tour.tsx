"use client";
import { useTranslations } from "next-intl";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useIsNarrowViewport } from "@/lib/use-narrow-viewport";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import {
  CARD_MARGIN,
  cutoutPath,
  holeRect,
  placeCard,
  type Rect,
  type Size,
} from "@/lib/spotlight-geometry";
import { tourSelector, type TourAnchor } from "@/lib/tour-anchors";

/**
 * Спотлайт-тур: затемняет страницу, вырезает «окно» вокруг реального
 * элемента (`data-tour`) и рядом показывает карточку шага.
 *
 * v1 — не интерактивный: клики по странице заблокированы, человек
 * смотрит, закрывает и делает сам. Скролл тела НЕ блокируем — цель
 * доскролливается `scrollIntoView`, а вырез следует за ней (пересчёт на
 * scroll / resize / visualViewport / ResizeObserver).
 *
 * Портал в body обязателен: в Mini App `.mini-root > *` создаёт stacking
 * context и любой `fixed` внутри shell-контейнера уходит под нижнюю
 * навигацию. `z-[70]` — выше WhatsNew (55), sheet-панелей гайда и MiniTour
 * (60), Radix-диалогов (50).
 */
export type SpotlightStep = {
  id: string;
  anchor: TourAnchor;
  fallbackAnchor?: TourAnchor;
  title: string;
  body: string;
};

/**
 * Manrope пришпилен к `.app-shell` (app-theme.css), а порталы в body его
 * не наследуют — иначе окно и тур рисуются системным шрифтом.
 */
export const PORTAL_FONT_FAMILY =
  "var(--font-manrope), Manrope, \"Segoe UI\", sans-serif";

/**
 * Жил здесь и тянул весь тур в пять чужих файлов ради двух строк.
 * Реэкспорт оставлен, чтобы не править импорты в шести местах.
 */
export { useIsNarrowViewport } from "@/lib/use-narrow-viewport";

function isVisible(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === "function" && !el.checkVisibility()) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Первый видимый элемент шага: сначала `anchor`, потом `fallback`. */
export function findTourTarget(
  anchor: TourAnchor,
  fallback?: TourAnchor
): HTMLElement | null {
  if (typeof document === "undefined") return null;
  for (const candidate of fallback ? [anchor, fallback] : [anchor]) {
    const nodes = document.querySelectorAll<HTMLElement>(tourSelector(candidate));
    for (const node of nodes) {
      if (isVisible(node)) return node;
    }
  }
  return null;
}

/**
 * Ждёт появления цели до `timeoutMs` (список Mini App грузится клиентски
 * со скелетоном; после навигации с `?tour=` таблица тоже рисуется не сразу).
 */
export function waitForTourTarget(
  anchor: TourAnchor,
  fallback?: TourAnchor,
  timeoutMs = 3000
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const el = findTourTarget(anchor, fallback);
      if (el || Date.now() - started >= timeoutMs) {
        resolve(el);
        return;
      }
      window.setTimeout(tick, 100);
    };
    tick();
  });
}

export function SpotlightTour({
  steps,
  startStepId,
  onClose,
}: {
  steps: SpotlightStep[];
  startStepId?: string;
  onClose: () => void;
}) {
  const t = useTranslations("journalControls.guide");
  // Шаги, у которых на странице есть цель, — считаем один раз при открытии,
  // чтобы счётчик «Шаг N из M» не прыгал.
  const [available] = useState(() =>
    steps.filter((step) => findTourTarget(step.anchor, step.fallbackAnchor))
  );
  const [index, setIndex] = useState(() => {
    const i = startStepId ? available.findIndex((s) => s.id === startStepId) : -1;
    return i >= 0 ? i : 0;
  });
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [cardSize, setCardSize] = useState<Size | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const narrow = useIsNarrowViewport();
  const step = available[index] ?? null;
  const isLast = index >= available.length - 1;

  const goNext = useCallback(() => {
    if (index >= available.length - 1) onClose();
    else setIndex((i) => i + 1);
  }, [index, available.length, onClose]);
  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Нет ни одной цели — закрываемся молча (launcher уже предупредил).
  useEffect(() => {
    if (available.length === 0) onClose();
  }, [available.length, onClose]);

  const measure = useCallback(() => {
    setViewport({ width: window.innerWidth, height: window.innerHeight });
    const el = targetRef.current;
    if (!el || !el.isConnected) {
      setTargetRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setTargetRect({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, []);

  // Смена шага: найти цель, доскроллить, замерять пока она видна.
  useEffect(() => {
    if (!step) return;
    const el = findTourTarget(step.anchor, step.fallbackAnchor);
    targetRef.current = el;
    if (el) {
      try {
        el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      } catch {
        el.scrollIntoView();
      }
    }
    measure();
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    const observer =
      el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (el && observer) observer.observe(el);
    // Плавный скролл идёт ~300 мс; scroll-события его сопровождают, но
    // финальную позицию добиваем отдельным замером.
    const settle = window.setTimeout(measure, 450);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [step, measure]);

  // Размер карточки — до отрисовки, чтобы разместить её без прыжка.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const next = { width: el.offsetWidth, height: el.offsetHeight };
    setCardSize((prev) =>
      prev && prev.width === next.width && prev.height === next.height ? prev : next
    );
    // Высота меняется вместе с текстом шага, шириной экрана и строкой
    // «элемент не виден» — этого достаточно, чтобы не мерить каждый рендер.
  }, [step, narrow, targetRect]);

  // Клавиатура: Esc — закрыть, стрелки — навигация. Фокус — на карточку,
  // при закрытии возвращаем туда, где он был.
  const handlers = useRef({ goNext, goPrev, onClose });
  useEffect(() => {
    handlers.current = { goNext, goPrev, onClose };
  });
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        handlers.current.onClose();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        handlers.current.goNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        handlers.current.goPrev();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, []);

  if (!step || typeof document === "undefined") return null;

  const hole = targetRect ? holeRect(targetRect) : null;
  const size = cardSize ?? {
    width: Math.min(360, Math.max(viewport.width - 24, 0)),
    height: 220,
  };
  const placement = hole && !narrow ? placeCard({ viewport, hole, card: size }) : null;
  const path =
    hole && viewport.width > 0
      ? cutoutPath(viewport, hole)
      : `M0 0H${viewport.width}V${viewport.height}H0Z`;

  return createPortal(
    <div
      className="fixed inset-0 z-[70]"
      style={{ fontFamily: PORTAL_FONT_FAMILY }}
      role="dialog"
      aria-modal="true"
      aria-label={t("tour")}
    >
      <style>{`@keyframes wesetup-spotlight-pulse{0%,100%{box-shadow:0 0 0 2px rgba(85,102,246,.95),0 0 0 6px rgba(85,102,246,.25)}50%{box-shadow:0 0 0 2px rgba(85,102,246,.95),0 0 0 14px rgba(85,102,246,0)}}`}</style>
      {/* Click-catcher: evenodd-дырка в SVG пропускает клики на страницу,
          а v1 тура — только смотреть. */}
      <div className="absolute inset-0" aria-hidden />
      <svg
        className="pointer-events-none absolute inset-0"
        width={viewport.width}
        height={viewport.height}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        aria-hidden
      >
        <path d={path} fill="rgba(11,16,36,0.55)" fillRule="evenodd" />
      </svg>
      {hole ? (
        <div
          className="pointer-events-none absolute rounded-[12px]"
          style={{
            left: hole.x,
            top: hole.y,
            width: hole.width,
            height: hole.height,
            animation: "wesetup-spotlight-pulse 1.6s ease-in-out infinite",
          }}
          aria-hidden
        />
      ) : null}

      <div
        key={step.id}
        ref={cardRef}
        tabIndex={-1}
        className={`absolute rounded-2xl border border-[#ececf4] bg-white p-4 shadow-[0_24px_60px_-24px_rgba(11,16,36,0.35)] outline-none animate-in fade-in-0 zoom-in-95 duration-200 ${
          narrow ? "inset-x-3" : "w-[min(360px,calc(100vw-24px))]"
        }`}
        style={
          narrow
            ? { bottom: "var(--safe-b)" }
            : { top: placement?.top ?? CARD_MARGIN, left: placement?.left ?? CARD_MARGIN }
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div
            className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]"
            aria-live="polite"
          >
            {t("progress", { current: String(index + 1), total: String(available.length) })}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeHint")}
            className="-m-2 rounded-full p-2 text-[#9b9fb3] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-1.5 text-[15px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]">
          {step.title}
        </div>
        <p className="mt-1.5 text-[13px] leading-[1.55] text-[#3c4053]">{step.body}</p>
        {!targetRect ? (
          <p className="mt-2 text-[12px] text-[#a13a32]">
            {t("invisible")}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5" aria-hidden>
            {available.map((s, i) => (
              <span
                key={s.id}
                className={`h-1.5 rounded-full transition-all ${
                  i === index
                    ? "w-6 bg-[#5566f6]"
                    : i < index
                      ? "w-2 bg-[#5566f6]/50"
                      : "w-2 bg-[#dcdfed]"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <button
                type="button"
                onClick={goPrev}
                className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                <ArrowLeft className="size-3.5" />
                {t("back")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={goNext}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3.5 text-[13px] font-semibold text-white shadow-[0_10px_26px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
            >
              {isLast ? t("done") : t("next")}
              {isLast ? null : <ArrowRight className="size-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
