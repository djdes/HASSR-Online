"use client";

import { startTransition, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { cn } from "@/lib/utils";

/** How far ahead of the screen the content is rendered for the first time. */
const MOUNT_MARGIN = "100% 0px";
/** Beyond this distance from the screen the content skips style and layout. */
const VISIBLE_MARGIN = "400px 0px";

/**
 * Heavy content far below the fold that costs nothing until the person gets
 * near it.
 *
 * Why: the timesheet on `/settings/users` is 95% of the page's DOM. Every
 * dialog, menu or toast inserted into `<body>` makes Chrome recalculate the
 * styles of the whole document (global `:has()` rules hang on `body`/`html`),
 * so with the timesheet in the DOM a dialog took 0.9 s on a fast CPU and 4.6 s
 * on an office laptop. Here the content:
 *  - is rendered only when it comes within a screen of the viewport (in a
 *    transition — React renders it in slices, the page stays responsive);
 *  - once rendered, gets `content-visibility: hidden` while it is far from the
 *    viewport: the browser keeps its last size but skips its style, layout and
 *    paint, and brings it back a little before it scrolls into view.
 * Printing always sees it (`beforeprint`, `print:` override, `forceMount`).
 * Browsers without IntersectionObserver / content-visibility get the content as
 * before.
 */
export function OffscreenSection(props: {
  children: ReactNode;
  /** Placeholder height before the content has ever rendered, px. */
  estimatedHeight: number;
  /** Render right now (e.g. before printing from an in-page button). */
  forceMount?: boolean;
  /** What to show until then (a light skeleton). */
  placeholder?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [far, setFar] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      // Very old browser: just render it, right after hydration.
      const timer = window.setTimeout(() => setMounted(true), 0);
      return () => window.clearTimeout(timer);
    }
    const mountObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        mountObserver.disconnect();
        startTransition(() => setMounted(true));
      },
      { rootMargin: MOUNT_MARGIN },
    );
    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        const latest = entries[entries.length - 1];
        if (latest) setFar(!latest.isIntersecting);
      },
      { rootMargin: VISIBLE_MARGIN },
    );
    mountObserver.observe(element);
    visibilityObserver.observe(element);
    // Ctrl+P / the browser menu: the sheet must contain the content.
    const beforePrint = () =>
      flushSync(() => {
        setMounted(true);
        setFar(false);
      });
    // Re-arm: the observer reports the current state again on observe().
    const afterPrint = () => {
      visibilityObserver.unobserve(element);
      visibilityObserver.observe(element);
    };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      mountObserver.disconnect();
      visibilityObserver.disconnect();
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, []);

  const show = mounted || props.forceMount === true;
  return (
    <div
      ref={ref}
      data-offscreen={show ? (far ? "hidden" : "visible") : "pending"}
      // Inline content-visibility beats a class, so the print override needs `!`.
      className={cn("print:[content-visibility:visible]!", props.className)}
      style={offscreenSectionStyle({ show, far, estimatedHeight: props.estimatedHeight })}
    >
      {show ? props.children : (props.placeholder ?? null)}
    </div>
  );
}

/**
 * Inline style of the wrapper. `contain-intrinsic-height: auto <px>` makes the
 * browser remember the real height while the content is rendered and use it
 * while it is skipped, so hiding never shifts the page.
 */
export function offscreenSectionStyle(state: { show: boolean; far: boolean; estimatedHeight: number }): CSSProperties {
  const height = Math.max(0, Math.round(state.estimatedHeight));
  if (!state.show) return { minHeight: height };
  return {
    contentVisibility: state.far ? "hidden" : "visible",
    containIntrinsicHeight: `auto ${height}px`,
  };
}
