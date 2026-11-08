"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp } from "lucide-react";

/**
 * «Наверх» (08.11.2026): на телефоне в кабинете после прокрутки больше двух
 * экранов — круглая кнопка над доком плавающих кнопок. Длинные списки
 * журналов и таблицы не нужно листать обратно пальцем. «Без анимации»
 * (Удобство чтения или система) — прыжок без плавности.
 */
export function BackToTop() {
  const t = useTranslations("common.quickActions");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > window.innerHeight * 2);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;
  return (
    <button
      type="button"
      data-testid="back-to-top"
      aria-label={t("toTop")}
      title={t("toTop")}
      onClick={() => {
        const still =
          document.documentElement.hasAttribute("data-view-still") ||
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
      }}
      className="fixed right-4 z-40 inline-flex size-11 items-center justify-center rounded-full border border-[#dcdfed] bg-white/95 text-[#3848c7] shadow-[0_10px_28px_-12px_rgba(11,16,36,0.45)] backdrop-blur transition-colors hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 md:hidden print:hidden"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 92px)" }}
    >
      <ArrowUp className="size-5" aria-hidden />
    </button>
  );
}
