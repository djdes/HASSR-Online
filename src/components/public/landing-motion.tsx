"use client";

import { useEffect } from "react";

const IN_VIEW = "true";
const OUT_OF_VIEW = "false";

function isNearViewport(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const margin = Math.min(320, Math.max(160, window.innerHeight * 0.28));
  return rect.bottom >= -margin && rect.top <= window.innerHeight + margin;
}

export function LandingMotion() {
  useEffect(() => {
    const root = document.documentElement;
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".landing-page > section:not(.landing-hero), .landing-page footer"
      )
    );

    // «Без анимации» в Удобстве чтения (флаг на <html>) — как системное
    // «Уменьшить движение»: секции видны сразу.
    const reduceMotion =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      root.hasAttribute("data-view-still");

    for (const target of targets) {
      target.dataset.inview =
        reduceMotion || isNearViewport(target) ? IN_VIEW : OUT_OF_VIEW;
    }

    root.classList.add("landing-motion-ready");
    root.classList.toggle("landing-motion-reduced", reduceMotion);

    if (reduceMotion || targets.length === 0) {
      return () => {
        root.classList.remove("landing-motion-ready");
        root.classList.remove("landing-motion-reduced");
        for (const target of targets) delete target.dataset.inview;
      };
    }

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      const section = target?.closest<HTMLElement>(
        ".landing-page > section:not(.landing-hero), .landing-page footer"
      );
      if (section) section.dataset.inview = IN_VIEW;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          (entry.target as HTMLElement).dataset.inview = entry.isIntersecting
            ? IN_VIEW
            : OUT_OF_VIEW;
        }
      },
      {
        rootMargin: "240px 0px 240px",
        threshold: 0.01,
      }
    );

    for (const target of targets) observer.observe(target);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", handleFocusIn);
      root.classList.remove("landing-motion-ready");
      root.classList.remove("landing-motion-reduced");
      for (const target of targets) delete target.dataset.inview;
    };
  }, []);

  return null;
}
