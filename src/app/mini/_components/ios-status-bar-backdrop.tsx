"use client";

import { useEffect, useRef, useState } from "react";

import { isInsideMobileApp, needsIosStatusBarBackdrop } from "@/lib/mobile-app";

/**
 * iPhone: тёмная подложка под часами и «чёлкой», которая не уезжает с
 * клавиатурой. Когда клавиатура открыта, iOS сдвигает видимую область, а
 * шапка оболочки (sticky) уезжает вместе со страницей — без подложки под
 * часами оказывался текст страницы. Подложка цвета шапки держится у
 * верхнего края видимой области (`visualViewport.offsetTop`).
 *
 * Слой 90 — выше окон подтверждения и шторок (z-60) и обучающего тура
 * (z-70): иначе окно «Удалить аккаунт навсегда?» с открытой клавиатурой
 * заезжало на часы. Нажатия подложка не перехватывает.
 */
export function IosStatusBarBackdrop() {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    const show = needsIosStatusBarBackdrop({
      userAgent: navigator.userAgent,
      inApp: isInsideMobileApp(),
      standalone,
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
    });
    // Решение только после монтирования: сервер про телефон не знает.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (show) setOn(true);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const el = ref.current;
    if (!on || !viewport || !el) return;
    const sync = () => {
      el.style.transform = `translateY(${Math.max(0, viewport.offsetTop)}px)`;
    };
    sync();
    viewport.addEventListener("scroll", sync);
    viewport.addEventListener("resize", sync);
    return () => {
      viewport.removeEventListener("scroll", sync);
      viewport.removeEventListener("resize", sync);
    };
  }, [on]);

  if (!on) return null;
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0"
      style={{ height: "env(safe-area-inset-top, 0px)", background: "#0b1024", zIndex: 90 }}
    />
  );
}
