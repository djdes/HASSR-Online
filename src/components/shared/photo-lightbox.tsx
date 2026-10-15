"use client";

import { useQrFillCopy } from "@/components/qr-fill/qr-fill-presentation";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import {
  MIN_ZOOM,
  ZOOM_IDENTITY,
  clampPan,
  clampScale,
  distance,
  isZoomed,
  midpoint,
  nextDoubleTapState,
  zoomAround,
  type ZoomPoint,
  type ZoomState,
} from "./photo-zoom";

/** Два касания ближе по времени и месту — это двойное касание. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 24;

export function PhotoLightbox({
  url,
  filename,
  caption,
  onClose,
}: {
  url: string;
  filename: string;
  /**
   * Подпись под картинкой. Нужна превью бланков: в полный экран
   * открывается лист без шапки, и без названия непонятно, чей он.
   */
  caption?: string;
  onClose: () => void;
}) {
  const { t } = useQrFillCopy();
  const [loaded, setLoaded] = useState(false);
  const [zoom, setZoom] = useState<ZoomState>(ZOOM_IDENTITY);
  // Жест идёт — плавность выключена, иначе картинка отстаёт от
  // пальца. Отдельное состояние, а не ref: читать ref в рендере
  // нельзя — значение там окажется прошлым.
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Состояние жеста — в ref: пересчитывать компонент на каждом кадре
  // движения пальцев значит превратить щипок в слайд-шоу.
  const gesture = useRef<{
    mode: "none" | "pan" | "pinch";
    startDistance: number;
    startScale: number;
    startPoint: ZoomPoint;
    startState: ZoomState;
  }>({
    mode: "none",
    startDistance: 0,
    startScale: 1,
    startPoint: { x: 0, y: 0 },
    startState: ZOOM_IDENTITY,
  });
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Новое фото — новый масштаб. Иначе следующее открывается приближённым
  // куском предыдущего. Сброс прямо в рендере, а не в эффекте:
  // в эффекте новое фото успевает мигнуть в масштабе предыдущего.
  const [shownUrl, setShownUrl] = useState(url);
  if (shownUrl !== url) {
    setShownUrl(url);
    setZoom(ZOOM_IDENTITY);
    setLoaded(false);
  }

  /** Координаты относительно центра сцены — в них считает `photo-zoom`. */
  const toStageCenter = useCallback((point: ZoomPoint): ZoomPoint => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: point.x - (rect.left + rect.width / 2),
      y: point.y - (rect.top + rect.height / 2),
    };
  }, []);

  const settle = useCallback((next: ZoomState): ZoomState => {
    const stage = stageRef.current?.getBoundingClientRect();
    const img = imgRef.current;
    if (!stage || !img) return next;
    // Размер картинки берём в её «единичном» виде: offsetWidth не
    // зависит от transform, а вот getBoundingClientRect — зависит,
    // и клампинг считался бы от уже увеличенного размера.
    return clampPan(
      next,
      { width: stage.width, height: stage.height },
      { width: img.offsetWidth, height: img.offsetHeight }
    );
  }, []);

  const onTouchStart = (event: React.TouchEvent) => {
    const touches = event.touches;
    if (touches.length === 2) {
      const a = { x: touches[0].clientX, y: touches[0].clientY };
      const b = { x: touches[1].clientX, y: touches[1].clientY };
      setDragging(true);
      gesture.current = {
        mode: "pinch",
        startDistance: Math.max(1, distance(a, b)),
        startScale: zoom.scale,
        startPoint: toStageCenter(midpoint(a, b)),
        startState: zoom,
      };
      return;
    }
    if (touches.length === 1 && isZoomed(zoom)) {
      setDragging(true);
      gesture.current = {
        mode: "pan",
        startDistance: 0,
        startScale: zoom.scale,
        startPoint: { x: touches[0].clientX, y: touches[0].clientY },
        startState: zoom,
      };
    }
  };

  const onTouchMove = (event: React.TouchEvent) => {
    const state = gesture.current;
    if (state.mode === "none") return;
    // Пока фото приближено, страница под ним двигаться не должна —
    // иначе половина движений уходит в прокрутку списка позади.
    if (event.cancelable) event.preventDefault();

    if (state.mode === "pinch" && event.touches.length === 2) {
      const a = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      const b = { x: event.touches[1].clientX, y: event.touches[1].clientY };
      const factor = distance(a, b) / state.startDistance;
      const next = zoomAround(
        state.startState,
        state.startPoint,
        clampScale(state.startScale * factor)
      );
      setZoom(settle(next));
      return;
    }

    if (state.mode === "pan" && event.touches.length === 1) {
      const touch = event.touches[0];
      setZoom(
        settle({
          scale: state.startState.scale,
          x: state.startState.x + (touch.clientX - state.startPoint.x),
          y: state.startState.y + (touch.clientY - state.startPoint.y),
        })
      );
    }
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    if (event.touches.length === 0) {
      gesture.current.mode = "none";
      setDragging(false);
    }
    if (event.changedTouches.length !== 1) return;

    const touch = event.changedTouches[0];
    const now = event.timeStamp;
    const previous = lastTap.current;
    const isSecondTap =
      previous !== null &&
      now - previous.at < DOUBLE_TAP_MS &&
      Math.abs(touch.clientX - previous.x) < DOUBLE_TAP_SLOP_PX &&
      Math.abs(touch.clientY - previous.y) < DOUBLE_TAP_SLOP_PX;

    if (isSecondTap) {
      lastTap.current = null;
      const focal = toStageCenter({ x: touch.clientX, y: touch.clientY });
      setZoom((current) => settle(nextDoubleTapState(current, focal)));
      return;
    }
    lastTap.current = { at: now, x: touch.clientX, y: touch.clientY };
  };

  const zoomed = isZoomed(zoom);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      // Пока фото приближено, тап по фону не закрывает: он почти всегда
      // промах пальца при перетаскивании, а не намерение выйти.
      onClick={zoomed ? undefined : onClose}
    >
      <BodyScrollLock />
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-full bg-black/50 p-2 text-white"
        aria-label={t("common.close")}
      >
        <X className="size-5" />
      </button>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </div>
      )}
      <div
        ref={stageRef}
        className="flex max-h-full max-w-full flex-col items-center gap-3 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => {
          gesture.current.mode = "none";
          setDragging(false);
        }}
        // Жесты страницы здесь наши: без этого iOS уводит щипок в
        // масштабирование всей страницы.
        style={{ touchAction: zoomed ? "none" : "pinch-zoom" }}
      >
        <img
          ref={imgRef}
          src={url}
          alt={caption ?? filename}
          draggable={false}
          className="max-h-full min-h-0 max-w-full rounded-lg object-contain"
          style={{
            transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
            // Во время жеста плавность не нужна — она отстаёт от пальца;
            // после двойного касания, наоборот, нужна.
            transition: dragging
              ? "none"
              : "transform 0.18s cubic-bezier(0.2, 0, 0, 1)",
            willChange: "transform",
          }}
          onLoad={() => setLoaded(true)}
        />
        {caption ? (
          <div className="max-w-[720px] shrink-0 text-center text-[13px] leading-snug text-white/80">
            {caption}
          </div>
        ) : null}
      </div>
      {/* Подсказка нужна один раз: жеста не видно, пока о нём не знаешь. */}
      {loaded && zoom.scale === MIN_ZOOM ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-[12px] text-white/45">
          {t("photo.zoomHint")}</div>
      ) : null}
    </div>
  );
}
