"use client";

import { toast } from "sonner";

/**
 * Тост о смене точки — один вид на все случаи (владелец, 2026-11-11): и ручной
 * выбор в шапке, и автосмена по разделу. Короткий, с кольцом-отсчётом, и —
 * когда есть куда — кнопкой «Вернуться на „…“»: нажал не туда — одно нажатие
 * назад. Место тоста — под шапкой по центру контента (`dashboard-toaster`),
 * чтобы он не закрывал сам переключатель.
 */

export const POINT_TOAST_MS = 5000;

/** Длинное название точки в кнопке — с многоточием: кнопка остаётся в одну строку. */
export function shortPointName(name: string): string {
  return name.length > 26 ? `${name.slice(0, 25).trimEnd()}…` : name;
}

/** Кольцо, убывающее за время жизни подсказки (`globals.css`, `toast-countdown`). */
export function ToastCountdown({ ms }: { ms: number }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-[18px] -rotate-90"
      aria-hidden
      data-toast-countdown
      style={{ "--toast-life": `${ms}ms` } as React.CSSProperties}
    >
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2.2" opacity="0.18" />
      <circle data-ring cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" pathLength={100} />
    </svg>
  );
}

let lastToastId: string | number | null = null;

/**
 * Показать тост смены точки. `back` — кнопка возврата (подпись уже
 * переведена); без неё — просто короткое сообщение с отсчётом.
 */
export function showPointSwitchToast(message: string, back?: { label: string; onClick: () => void } | null) {
  // Прежний тост смены — убрать: «вернуться» к точке до прошлой смены уже не к месту.
  if (lastToastId !== null) toast.dismiss(lastToastId);
  lastToastId = toast.success(message, {
    duration: POINT_TOAST_MS,
    icon: <ToastCountdown ms={POINT_TOAST_MS} />,
    action: back ? { label: back.label, onClick: back.onClick } : undefined,
  });
}
