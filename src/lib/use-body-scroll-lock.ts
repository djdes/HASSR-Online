"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

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
 * снимается, когда закрылось последнее. Хук — для самописных оверлеев
 * (`ConfirmDialog`, «Что нового», анкета, гайды).
 *
 * Radix-слои (`Dialog`, лист `BottomSheet` на vaul) страницу держат через
 * react-remove-scroll: `body { overflow: hidden; position: relative }` с
 * `!important`. На iPhone этого мало (владелец, 2026-11-23: «в меню при
 * скролле вниз скролится фон»): прокрутка окна берётся с `html` — у него
 * `overflow-x: clip`, — а не с `body`, и палец двигает страницу под листом.
 * Свои защиты vaul для iOS у нас не включаются: они ждут открытия через
 * `Drawer.Trigger`, а листы открываются из кода. Поэтому `position: fixed`
 * ставим с `!important` (иначе его перебивает правило Radix), а Radix-слои
 * на сенсорных устройствах зовут `TouchBodyScrollLock`.
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
  // С `!important`: под Radix-слоем на body действует
  // `position: relative !important` от react-remove-scroll.
  body.style.setProperty("position", "fixed", "important");
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.overflow = "hidden";
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
  // Липкая шапка мини-приложения при прибитом body перестаёт липнуть и
  // уезжает за верх экрана вместе со страницей. Сдвиг отдаём CSS
  // (globals.css), он возвращает шапку на место, пока открыто окно.
  const html = document.documentElement;
  html.style.setProperty("--body-lock-y", `${scrollY}px`);
  html.setAttribute("data-body-locked", "");
}

function clearHeaderOffset(): void {
  const html = document.documentElement;
  html.removeAttribute("data-body-locked");
  html.style.removeProperty("--body-lock-y");
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
    clearHeaderOffset();
    return;
  }
  body.style.position = restore.position;
  body.style.top = restore.top;
  body.style.left = restore.left;
  body.style.right = restore.right;
  body.style.overflow = restore.overflow;
  body.style.paddingRight = restore.paddingRight;
  clearHeaderOffset();
  // Возвращаемся на прежнее место мгновенно, даже если у html
  // scroll-behavior: smooth — иначе страница «уезжает» анимацией.
  const html = document.documentElement;
  const prevBehavior = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  window.scrollTo(0, restore.scrollY);
  html.style.scrollBehavior = prevBehavior;
}

/**
 * Под замком сменилась страница (слой остался открыт, а ссылка в нём увела на
 * другой адрес — так ведёт себя раздел меню, который и раскрывается, и
 * открывает свою страницу). Запомненная прокрутка относилась к прежней
 * странице: новая начинается сверху, и после закрытия слоя тоже.
 */
export function rebaseBodyScrollLock(): void {
  if (typeof document === "undefined" || locks === 0 || !saved) return;
  saved.scrollY = 0;
  document.body.style.top = "0px";
  document.documentElement.style.setProperty("--body-lock-y", "0px");
}

/** Держит прокрутку заблокированной, пока `active === true`. */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [active]);
}

/** Сенсорное устройство: палец — основной указатель (телефон, планшет). */
function isTouchDevice(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Замок для Radix-слоёв (`Dialog`, `BottomSheet`), только на сенсорных
 * устройствах: там он нужен (см. выше), а на компьютере страницу держит сам
 * Radix и лишний сдвиг на ширину полосы прокрутки ни к чему.
 */
export function useTouchBodyScrollLock(active: boolean): void {
  const locked = useRef(false);
  useEffect(() => {
    if (!active || !isTouchDevice()) return;
    lockBodyScroll();
    locked.current = true;
    return () => {
      locked.current = false;
      unlockBodyScroll();
    };
  }, [active]);
  // Переход на другую страницу при открытом слое — см. `rebaseBodyScrollLock`.
  const pathname = usePathname();
  const lastPathname = useRef(pathname);
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    if (locked.current) rebaseBodyScrollLock();
  }, [pathname]);
}

/** То же элементом — живёт, пока смонтировано содержимое слоя. */
export function TouchBodyScrollLock(): null {
  useTouchBodyScrollLock(true);
  return null;
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
