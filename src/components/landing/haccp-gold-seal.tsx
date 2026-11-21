"use client";

import { useId, useRef } from "react";

/**
 * Золотая печать «ХАССП / СЕРТИФИЦИРОВАНО» у плашки «Разработан при
 * консультации…» на первом экране (правки владельца 20.11.2026; пример —
 * зубчатая печать «HACCP CERTIFIED» с лаврами и красными лентами).
 *
 * Чистый SVG: без картинок и внешних шрифтов. Надписи — из словарей
 * (`landing.hero.sealTitle` / `sealCaption`). Цвета — атрибутами, а не
 * классами Tailwind: ночная тема и «Новая» перекрашивают классы, а печать
 * должна остаться золотой.
 *
 * Надписи (правки 21.11.2026, iPhone): сплошной цвет и сжатие `scale(x, 1)`
 * по ширине с запасом. Safari не применяет `textLength` к буквам, а градиент
 * на тексте обрезает по сжатой рамке — крайние «Х» и «П» выходили белыми.
 * Без `<use>`: гравировка нарисована двумя явными слоями.
 *
 * Анимация (печать ставится, раз в 8 с — покачивание, блик и искры) — в
 * globals.css (`.gold-seal*`), там же её выключение при «Уменьшить движение»
 * и «Без анимации». Нажатие на печать проигрывает «постановку» ещё раз.
 */

const CX = 60;
const CY = 57;

const round = (value: number) => Math.round(value * 100) / 100;

/** Зубчатый край: `teeth` острых зубцов между радиусами `outer` и `inner`. */
function rosettePath(teeth: number, outer: number, inner: number): string {
  const points = Array.from({ length: teeth * 2 }, (_, index) => {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = (Math.PI * index) / teeth - Math.PI / 2;
    return `${round(CX + radius * Math.cos(angle))} ${round(CY + radius * Math.sin(angle))}`;
  });
  return `M${points.join("L")}Z`;
}

function starPath(cx: number, cy: number, radius: number): string {
  const points = Array.from({ length: 10 }, (_, index) => {
    const r = index % 2 === 0 ? radius : radius * 0.45;
    const angle = (Math.PI * index) / 5 - Math.PI / 2;
    return `${round(cx + r * Math.cos(angle))} ${round(cy + r * Math.sin(angle))}`;
  });
  return `M${points.join("L")}Z`;
}

/** Левая ветвь лавра — квадратичная кривая снизу по центру вверх-влево. */
const STEM = { from: [56.5, 89.5], via: [41, 89], to: [34, 75.5] } as const;
const STEM_PATH = `M${STEM.from.join(" ")}Q${STEM.via.join(" ")} ${STEM.to.join(" ")}`;
/** Лист длиной 8 вдоль оси x, черешок в начале координат. */
const LEAF_PATH = "M0 0C1.9-2.4 5.6-2.7 8 0C5.6 2.7 1.9 2.4 0 0Z";

type Leaf = { x: number; y: number; angle: number; scale: number };

function laurelLeaves(): Leaf[] {
  const point = (t: number, axis: 0 | 1) =>
    (1 - t) ** 2 * STEM.from[axis] + 2 * (1 - t) * t * STEM.via[axis] + t ** 2 * STEM.to[axis];
  const slope = (t: number, axis: 0 | 1) =>
    2 * (1 - t) * (STEM.via[axis] - STEM.from[axis]) + 2 * t * (STEM.to[axis] - STEM.via[axis]);
  const tangent = (t: number) => (Math.atan2(slope(t, 1), slope(t, 0)) * 180) / Math.PI;
  const leaves: Leaf[] = [];
  for (const t of [0.16, 0.38, 0.6, 0.82]) {
    const x = round(point(t, 0));
    const y = round(point(t, 1));
    const scale = round(1.15 - t * 0.32);
    // Пара листьев «ёлочкой» вперёд по росту ветви: наружу и внутрь.
    leaves.push({ x, y, angle: round(tangent(t) - 40), scale }, { x, y, angle: round(tangent(t) + 40), scale });
  }
  leaves.push({ x: STEM.to[0], y: STEM.to[1], angle: round(tangent(1)), scale: 0.85 });
  return leaves;
}

const ROSETTE_PATH = rosettePath(36, 56, 51.5);
const STARS = [starPath(CX, 32, 4.6), starPath(CX - 11.5, 34.2, 2.9), starPath(CX + 11.5, 34.2, 2.9)];
const LEAVES = laurelLeaves();
/** Искра: вогнутая четырёхлучевая звезда радиусом 6. */
const SPARKLE_PATH = "M0-6C.6-1.2 1.2-.6 6 0 1.2.6.6 1.2 0 6-.6 1.2-1.2.6-6 0-1.2-.6-.6-1.2 0-6Z";
/**
 * Левая лента: полоса шириной 20 вниз-наружу (ось от 50,89 к 31,126) с
 * вырезом «ласточкин хвост», верх спрятан под печатью. Правая — она же,
 * отражённая; градиент поперёк ленты в координатах пользователя
 * отражается вместе с ней.
 */
const RIBBON_PATH = "M41.1 84.43L58.9 93.57 39.9 130.57 34.65 118.88 22.1 121.43Z";
const MIRROR = `translate(${CX * 2} 0) scale(-1 1)`;

/**
 * Ширина надписи с запасом: заглавная полужирная буква любого системного
 * шрифта (Helvetica Neue, Arial, Segoe UI, Roboto) — не шире 0,74 кегля.
 * Не влезает — сжимаем по горизонтали: одинаково во всех браузерах.
 */
const CAP_EM = 0.74;
export function sealTextScale(text: string, fontSize: number, maxWidth: number): number {
  const estimate = Math.max(1, [...text].length) * CAP_EM * fontSize;
  return round(Math.min(1, maxWidth / estimate));
}

const TITLE = { y: 56.5, size: 21, max: 64 };
const CAPTION = { y: 68.6, size: 9, max: 62 };
const INK = "#6a4300";
const INK_STROKE = "#7a4f04";
const HIGHLIGHT = "#fff4c6";

/** Нажатие — «печать ставится» ещё раз, с бликом и искрами (без анимации — ничего). */
function replaySeal(svg: SVGSVGElement | null) {
  if (!svg || typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  if (document.documentElement.hasAttribute("data-view-still")) return;
  svg.animate?.(
    [
      { transform: "scale(1) rotate(0deg)" },
      { transform: "scale(1.22) rotate(-12deg)", offset: 0.3 },
      { transform: "scale(0.94) rotate(4deg)", offset: 0.65 },
      { transform: "scale(1) rotate(0deg)" },
    ],
    { duration: 750, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  );
  svg.querySelector(".gold-seal-shine")?.animate?.(
    [{ transform: "translateX(-24px)" }, { transform: "translateX(150px)" }],
    { duration: 1100, delay: 250, easing: "cubic-bezier(0.45, 0, 0.25, 1)" },
  );
  svg.querySelectorAll(".gold-seal-sparkle").forEach((sparkle, index) => {
    sparkle.animate?.(
      [
        { opacity: 0, transform: "scale(0) rotate(0deg)" },
        { opacity: 1, transform: "scale(1.2) rotate(45deg)", offset: 0.45 },
        { opacity: 0, transform: "scale(0) rotate(90deg)" },
      ],
      { duration: 800, delay: 500 + index * 180, easing: "ease-in-out" },
    );
  });
}

export function HaccpGoldSeal({
  title,
  caption,
  className,
}: {
  /** Крупная надпись по центру: «ХАССП» / «HACCP». */
  title: string;
  /** Надпись под ней: «СЕРТИФИЦИРОВАНО» / «CERTIFIED». */
  caption: string;
  className?: string;
}) {
  // Свои id у градиентов: на странице может оказаться несколько печатей.
  const uid = `gs${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const id = (name: string) => `${uid}-${name}`;
  const ref = (name: string) => `url(#${id(name)})`;
  const svgRef = useRef<SVGSVGElement>(null);
  const titleScale = sealTextScale(title, TITLE.size, TITLE.max);
  const captionScale = sealTextScale(caption, CAPTION.size, CAPTION.max);

  // Всё «выгравированное» — двумя слоями: светлый отблеск со сдвигом вниз и тёмное золото сверху.
  const engraving = (layer: "light" | "ink") => {
    const fill = layer === "light" ? HIGHLIGHT : INK;
    return (
      <g
        key={layer}
        fill={fill}
        stroke={layer === "light" ? HIGHLIGHT : INK_STROKE}
        {...(layer === "light" ? { transform: "translate(0 0.8)", opacity: 0.9 } : {})}
      >
        <circle cx={CX} cy={CY} r="44" fill="none" strokeWidth="1.8" />
        <circle cx={CX} cy={CY} r="40.5" fill="none" strokeWidth="0.8" />
        {STARS.map((d) => (
          <path key={d} d={d} stroke="none" />
        ))}
        <text
          transform={`translate(${CX} ${TITLE.y}) scale(${titleScale} 1)`}
          textAnchor="middle"
          fontSize={TITLE.size}
          fontWeight="800"
          stroke="none"
        >
          {title}
        </text>
        <text
          transform={`translate(${CX} ${CAPTION.y}) scale(${captionScale} 1)`}
          textAnchor="middle"
          fontSize={CAPTION.size}
          fontWeight="700"
          stroke="none"
        >
          {caption}
        </text>
        {[false, true].map((mirrored) => (
          <g key={String(mirrored)} transform={mirrored ? MIRROR : undefined}>
            <path d={STEM_PATH} fill="none" strokeWidth="1.2" strokeLinecap="round" />
            {LEAVES.map((leaf) => (
              <path
                key={`${leaf.x}-${leaf.y}-${leaf.angle}`}
                d={LEAF_PATH}
                stroke="none"
                transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.angle}) scale(${leaf.scale})`}
              />
            ))}
          </g>
        ))}
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 120 132"
      className={className ? `gold-seal ${className}` : "gold-seal"}
      aria-hidden="true"
      focusable="false"
      onClick={() => replaySeal(svgRef.current)}
    >
      <defs>
        <linearGradient id={id("rim")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff4b8" />
          <stop offset="0.18" stopColor="#f7d25a" />
          <stop offset="0.38" stopColor="#dda327" />
          <stop offset="0.52" stopColor="#fbe592" />
          <stop offset="0.7" stopColor="#c68c12" />
          <stop offset="0.86" stopColor="#f2c84a" />
          <stop offset="1" stopColor="#a5710a" />
        </linearGradient>
        <linearGradient id={id("bevel")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff8da" />
          <stop offset="0.5" stopColor="#e6b443" />
          <stop offset="1" stopColor="#8c5c05" />
        </linearGradient>
        <radialGradient id={id("face")} cx="0.4" cy="0.32" r="0.8">
          <stop offset="0" stopColor="#fffbe3" />
          <stop offset="0.26" stopColor="#fce186" />
          <stop offset="0.6" stopColor="#efbd45" />
          <stop offset="0.86" stopColor="#d29a22" />
          <stop offset="1" stopColor="#b47d0d" />
        </radialGradient>
        {/* Лента объёмная: поперёк — светлая середина и тёмные края,
            вдоль — темнеет к хвосту. */}
        <linearGradient id={id("ribbon")} gradientUnits="userSpaceOnUse" x1="41.1" y1="84.43" x2="58.9" y2="93.57">
          <stop offset="0" stopColor="#c8141b" />
          <stop offset="0.42" stopColor="#f4473e" />
          <stop offset="1" stopColor="#a20d14" />
        </linearGradient>
        <linearGradient id={id("ribbonshade")} gradientUnits="userSpaceOnUse" x1="50" y1="89" x2="31" y2="126">
          <stop offset="0.3" stopColor="#4a0005" stopOpacity="0" />
          <stop offset="1" stopColor="#4a0005" stopOpacity="0.38" />
        </linearGradient>
        <linearGradient id={id("shine")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={id("clip")}>
          <path d={ROSETTE_PATH} />
        </clipPath>
      </defs>

      {[false, true].map((mirrored) => (
        <g key={String(mirrored)} transform={mirrored ? MIRROR : undefined}>
          <path d={RIBBON_PATH} fill={ref("ribbon")} stroke="#8a0a10" strokeWidth="0.6" strokeLinejoin="round" />
          <path d={RIBBON_PATH} fill={ref("ribbonshade")} />
        </g>
      ))}

      <path d={ROSETTE_PATH} fill={ref("rim")} stroke="#a8740c" strokeWidth="0.6" strokeLinejoin="round" />
      <circle cx={CX} cy={CY} r="50.3" fill={ref("face")} stroke={ref("bevel")} strokeWidth="2.6" />
      <circle cx={CX} cy={CY} r="46.9" fill="none" stroke="#a77712" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="0 3.07" />

      {engraving("light")}
      {engraving("ink")}

      <g clipPath={ref("clip")}>
        <path className="gold-seal-shine" d="M0-10H18L-12 140H-30Z" fill={ref("shine")} />
      </g>
      <g transform="translate(95 15)">
        <path className="gold-seal-sparkle" d={SPARKLE_PATH} fill="#ffffff" />
      </g>
      <g transform="translate(19 74) scale(0.7)">
        <path className="gold-seal-sparkle gold-seal-sparkle-late" d={SPARKLE_PATH} fill="#ffffff" />
      </g>
    </svg>
  );
}
