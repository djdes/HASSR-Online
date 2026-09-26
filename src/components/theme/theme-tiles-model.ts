import type { ThemeMode } from "./site-theme";

/**
 * Модель карточек темы («Светлая / Тёмная / Как на устройстве»).
 *
 * Отдельно от разметки, чтобы порядок карточек, выбор и клавиатура
 * проверялись юнит-тестом (`theme-tiles-model.test.ts`), а не только
 * глазами в браузере.
 */

export type ThemeTile = {
  mode: ThemeMode;
  label: string;
};

/** Порядок — как в приложении Claude: светлая, тёмная, системная. */
export const THEME_TILES: readonly ThemeTile[] = [
  { mode: "light", label: "Светлая" },
  { mode: "dark", label: "Тёмная" },
  { mode: "system", label: "Как на устройстве" },
];

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Какая карточка выбрана. Пока включена смена по времени суток, тему
 * задаёт час, а не выбор человека, — поэтому не выбрана ни одна:
 * подсвеченная «Светлая» ночью при тёмном экране вводила бы в заблуждение.
 */
export function selectedThemeTile(state: {
  mode: ThemeMode;
  autoBySchedule: boolean;
}): ThemeMode | null {
  return state.autoBySchedule ? null : state.mode;
}

/**
 * Куда ведут клавиши внутри ряда карточек — как у обычной группы
 * переключателей: стрелки по кругу, Home и End — к краям. `null` — клавиша
 * не наша, её обработает кто-то ещё (Tab, Esc, Enter).
 */
export function themeTileForKey(
  current: ThemeMode | null,
  key: string
): ThemeMode | null {
  const last = THEME_TILES.length - 1;
  const index = THEME_TILES.findIndex((tile) => tile.mode === current);
  let next: number;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      next = index < 0 ? 0 : index === last ? 0 : index + 1;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      next = index <= 0 ? last : index - 1;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = last;
      break;
    default:
      return null;
  }
  return THEME_TILES[next].mode;
}

/**
 * Цвета мини-превью. Рисуются атрибутами SVG, а не классами: слой тёмной
 * темы (`app-theme.css`) перекрашивает `bg-white`, `border-[#ececf4]` и
 * прочие хексы, и превью «Светлая» в тёмной теме стало бы тёмным.
 * Тёмная палитра — токены тёмной темы кабинета (`--app-bg`,
 * `--app-surface`, `--app-indigo`), чтобы превью совпадало с тем, что
 * человек увидит после нажатия.
 */
export type ThemePreviewPalette = {
  page: string;
  card: string;
  cardBorder: string;
  stripe: string;
  stripeSoft: string;
  dot: string;
};

export const THEME_PREVIEW_PALETTES: Record<"light" | "dark", ThemePreviewPalette> = {
  light: {
    page: "#eef0f8",
    card: "#ffffff",
    cardBorder: "#dcdfed",
    stripe: "#d5d9e8",
    stripeSoft: "#e7e9f2",
    dot: "#5566f6",
  },
  dark: {
    page: "#2b2841",
    card: "#3a3757",
    cardBorder: "#4c4870",
    stripe: "#757389",
    stripeSoft: "#5a5772",
    dot: "#7081f8",
  },
};

/** Относительная яркость по WCAG 2.x — для проверки палитр и контраста. */
export function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
