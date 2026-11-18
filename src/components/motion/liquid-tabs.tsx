"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Вкладки с «жидким» индикатором (язык движения сайта, спека
 * landing-mobile-polish-2026-11-18): плашка под выбранной вкладкой не
 * перескакивает и не едет жёстким прямоугольником — её передний край уходит
 * к новой вкладке раньше заднего, и плашка на мгновение вытягивается.
 *
 * Края — отступы `left` / `right` от контейнера (переменные `--liquid-*`),
 * у каждого своя пружина; какая быстрее, решает `data-dir` (см. `.motion-liquid`
 * в globals.css). Положение меряется по самой кнопке, поэтому ширина вкладок
 * может быть любой и меняться с языком.
 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type LiquidTab<T extends string> = { id: T; label: ReactNode; testId?: string };

export function LiquidTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  className,
  tabClassName,
  activeClassName = "text-[#0b1024]",
  idleClassName = "text-[#6f7282] hover:text-[#0b1024]",
  indicatorClassName = "rounded-xl bg-white shadow-[0_4px_14px_-8px_rgba(11,16,36,0.35)]",
}: {
  tabs: ReadonlyArray<LiquidTab<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
  tabClassName?: string;
  activeClassName?: string;
  idleClassName?: string;
  indicatorClassName?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const previousIndex = useRef(tabs.findIndex((tab) => tab.id === value));
  const [edges, setEdges] = useState<{ left: number; right: number } | null>(null);
  const [direction, setDirection] = useState<"left" | "right" | "none">("none");

  useIsomorphicLayoutEffect(() => {
    const root = list.current;
    if (!root) return;
    const measure = () => {
      const active = root.querySelector<HTMLElement>("[aria-selected='true']");
      if (!active) return;
      const left = active.offsetLeft;
      setEdges({ left, right: root.clientWidth - left - active.offsetWidth });
    };
    const index = tabs.findIndex((tab) => tab.id === value);
    if (index !== previousIndex.current) {
      setDirection(index > previousIndex.current ? "right" : "left");
      previousIndex.current = index;
    }
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // Ширина изменилась (поворот экрана, шрифты) — плашка встаёт без анимации.
    const observer = new ResizeObserver(() => {
      setDirection("none");
      measure();
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [value, tabs]);

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={ariaLabel}
      className={cn("relative flex rounded-2xl bg-[#f5f6ff] p-1", className)}
    >
      <span
        aria-hidden="true"
        data-dir={direction}
        data-ready={edges ? "true" : "false"}
        className={cn("motion-liquid", indicatorClassName, !edges && "opacity-0")}
        style={
          {
            "--liquid-top": "4px",
            "--liquid-bottom": "4px",
            "--liquid-left": `${edges?.left ?? 0}px`,
            "--liquid-right": `${edges?.right ?? 0}px`,
          } as React.CSSProperties
        }
      />
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={tab.testId}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative z-10 min-w-0 flex-auto rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
              tabClassName,
              active ? activeClassName : idleClassName,
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
