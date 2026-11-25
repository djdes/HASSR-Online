/**
 * Pure parts of `MotionNumber` (motion round 4): formatting, one frame of a count, and the
 * `--spring-soft` token turned into an easing function. Kept apart so `node:test` can run them.
 */

export type CountFormat = { fractionDigits?: number; group?: boolean };

const groupers = new Map<number, Intl.NumberFormat>();

/** The number as the page shows it: `toFixed`, or Russian grouping (`1 234,5`) when asked. */
export function formatCount(value: number, { fractionDigits = 0, group = false }: CountFormat = {}): string {
  if (!Number.isFinite(value)) return String(value);
  if (!group) return value.toFixed(fractionDigits);
  let format = groupers.get(fractionDigits);
  if (!format) {
    format = new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    groupers.set(fractionDigits, format);
  }
  return format.format(value);
}

/**
 * The value at `progress` (0…1, eased) of a count from `from` to `to`. The spring may pass 1 by
 * a hair; the count never shows a number beyond its target.
 */
export function countFrame(from: number, to: number, progress: number): number {
  const value = from + (to - from) * progress;
  return from <= to ? Math.min(Math.max(value, from), to) : Math.max(Math.min(value, from), to);
}

/** Ease-out used where the token cannot be read (old engine, no `linear()` value). */
export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * A `linear(a, b, c, …)` easing (evenly spaced points, as the spring tokens of `globals.css` are)
 * as a function of time. Anything else falls back to an ease-out.
 */
export function sampleLinear(token: string): (t: number) => number {
  const match = token.trim().match(/^linear\(([^)]*)\)$/);
  const points = match ? match[1].split(",").map((part) => Number(part.trim())) : [];
  if (points.length < 2 || points.some((point) => !Number.isFinite(point))) return easeOutCubic;
  const last = points.length - 1;
  return (t: number) => {
    if (t <= 0) return points[0];
    if (t >= 1) return points[last];
    const position = t * last;
    const index = Math.floor(position);
    const local = position - index;
    return points[index] + (points[index + 1] - points[index]) * local;
  };
}
