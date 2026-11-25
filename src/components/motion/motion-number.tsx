"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import { countFrame, formatCount, sampleLinear } from "@/components/motion/motion-number-model";

/**
 * A number that counts instead of jumping (motion round 4, `src/app/motion-data.css` has the bars
 * and rings). The server renders the final value, so the page looks the same at rest and without
 * JavaScript. On the client:
 *
 * • mounted by a client render (navigation, a card that opens) — counts up from 0;
 * • hydrated from server HTML — no count: the final value is already painted, a drop to 0 would
 *   flash;
 * • the value changes — counts from what is on the screen to the new value.
 *
 * The count writes the text node React owns (`nodeValue`, never `textContent`, so React keeps
 * its node) and ends on exactly the string React rendered. «Без анимации» (`data-view-still`) and
 * the system «Reduce motion» show the value at once.
 */

const COUNT_MS = 700;
const noop = () => () => {};

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function motionOff(): boolean {
  if (document.documentElement.hasAttribute("data-view-still")) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

let easing: ((t: number) => number) | null = null;
/** `--spring-soft` of `globals.css` as a function: the numbers ride the same curve as the bars. */
function softSpring(): (t: number) => number {
  if (easing === null) {
    const token = getComputedStyle(document.documentElement).getPropertyValue("--spring-soft");
    easing = sampleLinear(token);
  }
  return easing;
}

type Props = {
  value: number;
  /** Digits after the comma (0 by default). */
  fractionDigits?: number;
  /** Group thousands with a narrow space, as `toLocaleString("ru-RU")` does. */
  group?: boolean;
  /** Text right after the number in the same node, e.g. `%` or ` ₽`. */
  suffix?: string;
  className?: string;
};

export function MotionNumber({ value, fractionDigits = 0, group = false, suffix = "", className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  // `false` only while hydrating: the server snapshot is used then (see the comment above).
  const clientRender = useSyncExternalStore(noop, () => true, () => false);
  const countsIn = useRef(clientRender);
  const shown = useRef<number | null>(null);
  const text = formatCount(value, { fractionDigits, group }) + suffix;

  useIsomorphicLayoutEffect(() => {
    const node = ref.current?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    // What is on the screen now: the last frame of a count that was cut short, 0 for a number
    // that counts in, else the value itself.
    const from = shown.current ?? (countsIn.current ? 0 : value);
    if (from === value || !Number.isFinite(from) || !Number.isFinite(value) || motionOff()) {
      shown.current = value;
      return;
    }
    shown.current = from;

    const ease = softSpring();
    const options = { fractionDigits, group };
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_MS);
      if (t >= 1) {
        shown.current = value;
        node.nodeValue = text;
        return;
      }
      const current = countFrame(from, value, ease(t));
      shown.current = current;
      node.nodeValue = formatCount(current, options) + suffix;
      frame = requestAnimationFrame(tick);
    };
    node.nodeValue = formatCount(from, options) + suffix;
    frame = requestAnimationFrame(tick);
    // Cut short (a new value, unmount): the next run starts from the last frame in `shown`.
    return () => cancelAnimationFrame(frame);
  }, [value, fractionDigits, group, suffix, text]);

  return (
    <span ref={ref} className={className} data-motion-number="">
      {text}
    </span>
  );
}
