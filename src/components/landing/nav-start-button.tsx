"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { ymGoal } from "@/lib/signup-source";

/**
 * Кнопка «Начать бесплатно» в шапке лендинга для гостя.
 *
 * Пока hero с формой в кадре, кнопки нет — вторая точка входа на
 * первом экране конкурировала бы с полем почты. Как только hero ушёл
 * из вьюпорта, шапка без кнопки предлагает только «Войти», то есть
 * действие для существующих клиентов, — на все остальные секции.
 *
 * Клик не ведёт на /register (это второй шаг против принципа «одно
 * поле»), а возвращает к форме в hero и ставит в неё фокус. На
 * телефоне рядом не помещается «Тарифы»: html.landing-nav-cta прячет
 * его (см. globals.css).
 */
export function NavStartButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hero = document.querySelector<HTMLElement>(".landing-hero");
    if (!hero || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("landing-nav-cta", visible);
    return () => document.documentElement.classList.remove("landing-nav-cta");
  }, [visible]);

  if (!visible) return null;

  function handleClick() {
    ymGoal("nav_cta_click");
    const input = document.getElementById("hero-email") as HTMLInputElement | null;
    const target = input ?? document.querySelector<HTMLElement>(".landing-hero");
    if (!target) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    target.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
    });
    if (input) {
      window.setTimeout(
        () => input.focus({ preventScroll: true }),
        reduceMotion ? 0 : 450,
      );
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[16px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] sm:h-10 sm:text-[14px]"
    >
      <span className="sm:hidden">Начать</span>
      <span className="hidden sm:inline">Начать бесплатно</span>
      <ArrowRight className="size-4" />
    </button>
  );
}
