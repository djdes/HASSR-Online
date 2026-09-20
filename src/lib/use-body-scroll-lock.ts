"use client";

import { useEffect } from "react";

/**
 * Блокировка прокрутки страницы под всплывашкой.
 *
 * `body { overflow: hidden }` на iOS Safari не работает: палец по фону
 * всё равно двигает сайт за окном. Надёжный способ — зафиксировать body
 * (`position: fixed; top: -scrollY`) и вернуть прокрутку на то же место
 * при закрытии. Ширина полосы прокрутки компенсируется padding-right,
 * чтобы контент на десктопе не дёргался.
 *
 * Счётчик — для вложенных окон (подтверждение поверх анкеты): блокировка
 * снимается, когда закрылось последнее. Radix-диалоги (`Dialog`, `Sheet`)
 * делают то же сами через react-remove-scroll; хук — для самописных
 * оверлеев (`ConfirmDialog`, «Что нового», анкета, гайды).
 */
type SavedBodyStyle = {
  scrollY: number;
  position: string;
  top: string;
  left: string;
  right: string;
  overflow: string;
  paddingRight: string;
};

let locks = 0;
let saved: SavedBodyStyle | null = null;

export function lockBodyScroll(): void {
  if (typeof document === "undefined") return;
  if (locks++ > 0) return;
  const body = document.body;
  const scrollY = window.scrollY;
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;
  saved = {
    scrollY,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    overflow: body.style.overflow,
    paddingRight: body.style.paddingRight,
  };
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.overflow = "hidden";
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
}

export function unlockBodyScroll(): void {
  if (typeof document === "undefined" || locks === 0) return;
  if (--locks > 0) return;
  const restore = saved;
  saved = null;
  const body = document.body;
  if (!restore) {
    // Замок сняли, а запомненных стилей нет (окно пережило переход
    // между страницами, счётчик и снимок разъехались). Страницу нельзя
    // оставлять прибитой — снимаем фиксацию руками.
    body.style.position = "";
    body.style.top = "";
    body.style.left = "";
    body.style.right = "";
    body.style.overflow = "";
    body.style.paddingRight = "";
    return;
  }
  body.style.position = restore.position;
  body.style.top = restore.top;
  body.style.left = restore.left;
  body.style.right = restore.right;
  body.style.overflow = restore.overflow;
  body.style.paddingRight = restore.paddingRight;
  // Возвращаемся на прежнее место мгновенно, даже если у html
  // scroll-behavior: smooth — иначе страница «уезжает» анимацией.
  const html = document.documentElement;
  const prevBehavior = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  window.scrollTo(0, restore.scrollY);
  html.style.scrollBehavior = prevBehavior;
}

/** Держит прокрутку заблокированной, пока `active === true`. */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [active]);
}

/**
 * То же в виде элемента: положить первым ребёнком внутрь оверлея —
 * блокировка живёт ровно столько, сколько оверлей смонтирован. Удобно,
 * когда окно рендерится условно внутри большого компонента и тянуть
 * его state до хука неудобно.
 */
export function BodyScrollLock(): null {
  useBodyScrollLock(true);
  return null;
}
