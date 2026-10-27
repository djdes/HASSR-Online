/** Заготовка иллюстрации: рамка с подписью, пока рисунок не готов. */

import type { PosterArtProps } from "./types";

export function placeholderArt(name: string) {
  function Placeholder({ className, title }: PosterArtProps) {
    return (
      <svg viewBox="0 0 160 120" className={className} role="img" aria-label={title ?? name}>
        <rect
          x="4"
          y="4"
          width="152"
          height="112"
          rx="14"
          style={{ fill: "var(--pb-bg)", stroke: "var(--pb-secondary-ink)", strokeWidth: 2.5, strokeDasharray: "6 6" }}
        />
        <text x="80" y="64" textAnchor="middle" style={{ fill: "var(--pb-text)", fontSize: 11 }}>
          {name}
        </text>
      </svg>
    );
  }
  Placeholder.displayName = `PosterArt(${name})`;
  return Placeholder;
}
