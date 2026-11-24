"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Eraser } from "lucide-react";
import { PPK_BUTTON_TEXT_CLASS } from "@/components/production-control/ppk-ui";

/** Размер картинки подписи: 3 к 1, как строка листа ознакомления. */
const OUT_W = 600;
const OUT_H = 200;

/**
 * Поле «распишитесь пальцем»: рисование пальцем, мышью или стилусом
 * (Pointer Events), «Очистить». Наружу — PNG data URL или null, если поле
 * пустое. Линия тёмная на белом в обеих темах: подпись печатается на бумаге.
 */
export function SignaturePad({ onChange, disabled = false }: { onChange: (dataUrl: string | null) => void; disabled?: boolean }) {
  const t = useTranslations("productionControl.signature");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const strokes = useRef(0);
  const [empty, setEmpty] = useState(true);

  const context = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    return { canvas, ctx };
  }, []);

  /** Белый лист: подпись печатается на бумаге, фон картинки — белый. */
  const paintBlank = useCallback(() => {
    const target = context();
    if (!target) return;
    target.ctx.fillStyle = "#ffffff";
    target.ctx.fillRect(0, 0, OUT_W, OUT_H);
    strokes.current = 0;
  }, [context]);

  const reset = useCallback(() => {
    paintBlank();
    setEmpty(true);
    onChange(null);
  }, [paintBlank, onChange]);

  useEffect(() => {
    paintBlank();
  }, [paintBlank]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * OUT_W,
      y: ((event.clientY - rect.top) / rect.height) * OUT_H,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    last.current = point(event);
    const target = context();
    if (!target) return;
    // Точка — тоже штрих (короткая подпись, инициалы).
    target.ctx.fillStyle = "#0b1024";
    target.ctx.beginPath();
    target.ctx.arc(last.current.x, last.current.y, 1.6, 0, Math.PI * 2);
    target.ctx.fill();
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    event.preventDefault();
    const target = context();
    const from = last.current;
    if (!target || !from) return;
    const to = point(event);
    target.ctx.strokeStyle = "#0b1024";
    target.ctx.lineWidth = event.pointerType === "pen" ? 2.6 + (event.pressure || 0.5) * 1.5 : 3.2;
    target.ctx.lineCap = "round";
    target.ctx.lineJoin = "round";
    target.ctx.beginPath();
    target.ctx.moveTo(from.x, from.y);
    target.ctx.lineTo(to.x, to.y);
    target.ctx.stroke();
    last.current = to;
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    strokes.current += 1;
    setEmpty(false);
    onChange(canvasRef.current?.toDataURL("image/png") ?? null);
  }

  return (
    <div className="space-y-2" data-signature-pad>
      <div className="relative overflow-hidden rounded-2xl bg-white ring-1 ring-[#dcdde3]" data-keep-border>
        <canvas
          ref={canvasRef}
          width={OUT_W}
          height={OUT_H}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          aria-label={t("area")}
          role="img"
          className="block aspect-[3/1] w-full cursor-crosshair touch-none select-none"
        />
        {empty ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[14px] text-[#9b9fb3]">
            {t("placeholder")}
          </span>
        ) : null}
        <span className="pointer-events-none absolute right-4 bottom-[22%] left-4 border-b border-dashed border-[#c9cbd6]" aria-hidden data-keep-border />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] text-[#6f7282]">{t("hint")}</span>
        <button type="button" onClick={reset} disabled={disabled || empty} className={PPK_BUTTON_TEXT_CLASS}>
          <Eraser className="size-4" aria-hidden />
          {t("clear")}
        </button>
      </div>
    </div>
  );
}
