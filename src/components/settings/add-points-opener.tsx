"use client";

import { useEffect } from "react";

import { withoutAddPointsParam } from "@/lib/add-points";

/**
 * Пришли по «Добавить точку» (`?addPoints=1`, серия D, Р12): страница уже
 * отрисовала выбор тарифа с точкой больше оплаченного — прокручиваем к нему
 * и убираем метку из адреса, чтобы обновление страницы не открывало выбор
 * снова. Адрес меняем без перехода: сервер второй раз не зовём.
 */
export function AddPointsOpener({ targetId }: { targetId: string }) {
  useEffect(() => {
    try {
      const next = withoutAddPointsParam(`${window.location.pathname}${window.location.search}${window.location.hash}`);
      window.history.replaceState(window.history.state, "", next);
    } catch {
      /* адрес не поменять — не страшно */
    }
    const target = document.getElementById(targetId);
    if (!target) return;
    const frame = window.requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [targetId]);
  return null;
}
