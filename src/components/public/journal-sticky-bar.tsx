"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Нижняя полоса действий на телефоне (спека journal-page-engagement-2026-11):
 * «Скачать PDF · Попробовать» появляется, когда шапка с кнопками ушла из
 * вида, и прячется у финального блока. Пока полоса видна, плавающие
 * «Контакты» и «Онлайн-чат» поднимаются над ней (CSS-переменная
 * `--public-sticky-offset`). На компьютере полосы нет.
 */
export function JournalStickyBar({ watchId, endId, children }: { watchId: string; endId?: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hero = document.getElementById(watchId);
    const end = endId ? document.getElementById(endId) : null;
    if (!hero || typeof IntersectionObserver === "undefined") return;
    let heroVisible = true;
    let endVisible = false;
    const update = () => setVisible(!heroVisible && !endVisible);
    const heroObserver = new IntersectionObserver(([entry]) => {
      heroVisible = entry.isIntersecting;
      update();
    });
    heroObserver.observe(hero);
    const endObserver = end
      ? new IntersectionObserver(([entry]) => {
          endVisible = entry.isIntersecting;
          update();
        })
      : null;
    if (end) endObserver?.observe(end);
    return () => {
      heroObserver.disconnect();
      endObserver?.disconnect();
    };
  }, [watchId, endId]);

  useEffect(() => {
    const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
    document.documentElement.style.setProperty("--public-sticky-offset", visible && narrow ? "72px" : "0px");
    return () => {
      document.documentElement.style.removeProperty("--public-sticky-offset");
    };
  }, [visible]);

  return (
    <div
      data-testid="journal-sticky-bar"
      data-visible={visible ? "true" : "false"}
      aria-hidden={!visible}
      className={
        "fixed inset-x-0 bottom-0 z-30 border-t border-[#ececf4] bg-white/95 px-3 pt-2.5 backdrop-blur transition-transform duration-200 sm:hidden print:hidden " +
        (visible ? "translate-y-0" : "pointer-events-none translate-y-full")
      }
      style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="flex items-center gap-2 [&>*]:flex-1">{children}</div>
    </div>
  );
}
