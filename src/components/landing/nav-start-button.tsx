"use client";

import { useTranslations } from "next-intl";

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
 * поле»), а возвращает к форме в hero и ставит в неё фокус. Кнопка есть
 * с `md`: на телефоне в шапке одна строка — поиск, «Тарифы» и вход.
 */
export function NavStartButton() {
  const t = useTranslations("landingComponents.navStart");
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
      // `motion-pop`: кнопка не «включается», а проявляется из размытия.
      className="motion-pop hidden h-10 items-center gap-2 whitespace-nowrap rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0] md:inline-flex"
    >
      {t("startFree")}
      <ArrowRight className="size-4" />
    </button>
  );
}
