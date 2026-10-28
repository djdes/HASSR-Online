/**
 * Иллюстрации плакатов (2026-10-27) — свои векторные рисунки вместо картинок
 * неизвестного происхождения. Каждая — SVG `viewBox="0 0 160 120"`, линейный
 * стиль, скруглённые концы линий.
 *
 * Цвета — только CSS-переменные фирменного стиля через `style` (не
 * `currentColor` и не атрибуты `fill="…"` с var: печать кабинета делает
 * `currentColor` чёрным):
 * - контуры: `var(--pb-text)` (тёмный), толщина 2.5–3;
 * - акцент (вода, мыло, стрелки движения, детали формы): `var(--pb-secondary-ink)`;
 * - светлые заливки (кожа, фон предмета): `var(--pb-bg)`; белое — `#fff`;
 * - «правильно» / «неправильно» не только цветом, а значками ✓ / ✗.
 * В режиме «Ч/б» переменные становятся чёрными и белыми — рисунок остаётся
 * читаемым контуром.
 */

import type { ComponentType } from "react";

export type PosterArtProps = {
  className?: string;
  /** Подпись для экранного диктора; на бумаге не видна. */
  title?: string;
};

export type PosterArtComponent = ComponentType<PosterArtProps>;

/** Мытьё рук и обработка антисептиком — `hands.tsx`. */
export const HAND_ART_NAMES = [
  "hw-wet",
  "hw-soap",
  "hw-palms",
  "hw-backs",
  "hw-interlace",
  "hw-thumbs",
  "hw-fingertips",
  "hw-rinse",
  "hw-dry",
  "hw-tap-towel",
  "hw-timer",
  "as-dispenser",
  "as-palms",
  "as-backs",
  "as-knuckles",
  "as-thumbs",
  "as-fingertips",
] as const;

/** Люди и кухня: одежда повара, перекрёстные загрязнения, суточная проба, осмотр — `kitchen.tsx`. */
export const KITCHEN_ART_NAMES = [
  "chef-correct",
  "chef-wrong",
  "cc-raw-ready",
  "cc-boards",
  "cc-damaged",
  "cc-sanitize",
  "ds-jar",
  "ds-fridge",
  "ds-spoon",
  "ds-weight",
  "ds-portion",
  "di-skin",
  "di-throat",
  "di-survey",
  "di-thermometer",
] as const;

/** Дезинфекция, хранение, посуда и мелкие значки — `misc.tsx`. */
export const MISC_ART_NAMES = [
  "dz-gloves",
  "dz-closed-container",
  "dz-ventilation",
  "dz-respirator",
  "dz-wash-face",
  "eggs",
  "dishes",
  "storage",
  "hygiene",
  "icon-check",
  "icon-cross",
  "icon-warning",
  "icon-clock",
  "icon-thermometer",
  "icon-snowflake",
  "icon-label",
] as const;

export type HandArtName = (typeof HAND_ART_NAMES)[number];
export type KitchenArtName = (typeof KITCHEN_ART_NAMES)[number];
export type MiscArtName = (typeof MISC_ART_NAMES)[number];
export type PosterArtName = HandArtName | KitchenArtName | MiscArtName;

export const POSTER_ART_NAMES: readonly PosterArtName[] = [
  ...HAND_ART_NAMES,
  ...KITCHEN_ART_NAMES,
  ...MISC_ART_NAMES,
];
