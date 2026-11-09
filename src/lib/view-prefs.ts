/**
 * «Удобство чтения» — настройки ЭТОГО устройства: размер текста, высокий
 * контраст, анимация и пояснения на страницах (Настройки → Оформление, меню
 * профиля, профиль мини-приложения).
 *
 * Живут в куке `wesetup-view`, чтобы сервер рисовал первый кадр уже в них:
 * корневой layout ставит атрибуты на `<html>` (`viewPrefsHtmlAttributes`), CSS
 * (`src/app/view-prefs.css`) читает атрибуты. Без мигания «мелко → крупно».
 *
 * Как у темы — настройка устройства, а не профиля: на телефоне человек
 * читает крупно, за компьютером — обычно.
 *
 * «Как в системе» у контраста и анимации: решает настройка телефона или
 * компьютера (`prefers-contrast: more`, `prefers-reduced-motion: reduce`).
 * Сервер её не видит — действующий режим досчитывает скрипт до гидрации
 * (`viewPrefsBootstrapCode`) и тот же расчёт в клиенте (`effectiveViewFlags`).
 *
 * Модуль без React и без `window` — его берут сервер, клиент и тесты.
 */

export const VIEW_PREFS_COOKIE = "wesetup-view";

/** ~400 дней — дольше куку браузеры всё равно не хранят. */
export const VIEW_PREFS_MAX_AGE = 60 * 60 * 24 * 400;

export const TEXT_SIZES = ["normal", "large", "xlarge"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** `auto` — как в системе; `high` — всегда высокий. */
export const CONTRAST_MODES = ["auto", "high"] as const;
export type ContrastMode = (typeof CONTRAST_MODES)[number];

/** `auto` — как в системе; `reduce` — без анимации всегда. */
export const MOTION_MODES = ["auto", "reduce"] as const;
export type MotionMode = (typeof MOTION_MODES)[number];

/** Пояснения на страницах: подзаголовки и «Как это работает». */
export const HINTS_MODES = ["on", "off"] as const;
export type HintsMode = (typeof HINTS_MODES)[number];

/**
 * Шаблон меню кабинета на компьютере: `classic` — стандартный (меню раздела
 * сменяет главное), `new` — два уровня слева, остальные — строкой над
 * страницей (`lib/nav-layout.ts`). Переключатель — внизу меню слева.
 */
export const NAV_LAYOUTS = ["classic", "new"] as const;
export type NavLayout = (typeof NAV_LAYOUTS)[number];

export type ViewPrefs = {
  textSize: TextSize;
  contrast: ContrastMode;
  motion: MotionMode;
  hints: HintsMode;
  navLayout: NavLayout;
};

export const DEFAULT_VIEW_PREFS: ViewPrefs = {
  textSize: "normal",
  contrast: "auto",
  motion: "auto",
  hints: "on",
  navLayout: "classic",
};

/**
 * Множители кегля (см. `postcss-plugins/text-scale.cjs`): основной текст
 * (< 20px) и заголовки (20–31px). Значения дублирует `view-prefs.css` —
 * тест сверяет, что они совпадают.
 */
export const TEXT_SCALE: Record<TextSize, { text: number; heading: number }> = {
  normal: { text: 1, heading: 1 },
  large: { text: 1.15, heading: 1.08 },
  xlarge: { text: 1.3, heading: 1.15 },
};

const KEYS = { textSize: "t", contrast: "c", motion: "m", hints: "h", navLayout: "n" } as const;

function pick<T extends string>(allowed: readonly T[], value: string | undefined, fallback: T): T {
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Кука → настройки. Мусор и незнакомые значения — по умолчанию. */
export function parseViewPrefs(raw: string | null | undefined): ViewPrefs {
  const values = new Map<string, string>();
  let text = String(raw ?? "");
  try {
    text = decodeURIComponent(text);
  } catch {
    /* битая кодировка — разбираем как есть */
  }
  for (const part of text.split("|")) {
    const [key, value] = part.split(":");
    if (key && value !== undefined) values.set(key.trim(), value.trim());
  }
  return {
    textSize: pick(TEXT_SIZES, values.get(KEYS.textSize), DEFAULT_VIEW_PREFS.textSize),
    contrast: pick(CONTRAST_MODES, values.get(KEYS.contrast), DEFAULT_VIEW_PREFS.contrast),
    motion: pick(MOTION_MODES, values.get(KEYS.motion), DEFAULT_VIEW_PREFS.motion),
    hints: pick(HINTS_MODES, values.get(KEYS.hints), DEFAULT_VIEW_PREFS.hints),
    navLayout: pick(NAV_LAYOUTS, values.get(KEYS.navLayout), DEFAULT_VIEW_PREFS.navLayout),
  };
}

/** Настройки → значение куки: `t:large|c:auto|m:auto|h:on|n:classic`. */
export function serializeViewPrefs(prefs: ViewPrefs): string {
  return [
    `${KEYS.textSize}:${prefs.textSize}`,
    `${KEYS.contrast}:${prefs.contrast}`,
    `${KEYS.motion}:${prefs.motion}`,
    `${KEYS.hints}:${prefs.hints}`,
    `${KEYS.navLayout}:${prefs.navLayout}`,
  ].join("|");
}

/** Строка для `document.cookie`. */
export function viewPrefsCookieString(prefs: ViewPrefs): string {
  return `${VIEW_PREFS_COOKIE}=${serializeViewPrefs(prefs)}; Path=/; Max-Age=${VIEW_PREFS_MAX_AGE}; SameSite=Lax`;
}

/** Всё по умолчанию — куку можно не хранить. */
export function isDefaultViewPrefs(prefs: ViewPrefs): boolean {
  return (
    prefs.textSize === DEFAULT_VIEW_PREFS.textSize &&
    prefs.contrast === DEFAULT_VIEW_PREFS.contrast &&
    prefs.motion === DEFAULT_VIEW_PREFS.motion &&
    prefs.hints === DEFAULT_VIEW_PREFS.hints &&
    prefs.navLayout === DEFAULT_VIEW_PREFS.navLayout
  );
}

/**
 * Действующие режимы: выбор человека плюс настройка системы для «как в
 * системе». `systemHighContrast` / `systemReducedMotion` — ответы
 * `matchMedia`; на сервере их нет (false), досчитывает скрипт.
 */
export function effectiveViewFlags(
  prefs: Pick<ViewPrefs, "contrast" | "motion">,
  system: { highContrast: boolean; reducedMotion: boolean },
): { highContrast: boolean; still: boolean } {
  return {
    highContrast: prefs.contrast === "high" || (prefs.contrast === "auto" && system.highContrast),
    still: prefs.motion === "reduce" || (prefs.motion === "auto" && system.reducedMotion),
  };
}

/** Атрибут-флаг действующего высокого контраста на `<html>`. */
export const HIGH_CONTRAST_ATTR = "data-view-hc";
/** Атрибут-флаг «без анимации» на `<html>`. */
export const STILL_ATTR = "data-view-still";

/**
 * Атрибуты `<html>` для первой отрисовки. Флаги «как в системе» сервер не
 * знает — их поставит скрипт до гидрации.
 */
export function viewPrefsHtmlAttributes(prefs: ViewPrefs): Record<string, string> {
  const flags = effectiveViewFlags(prefs, { highContrast: false, reducedMotion: false });
  const attributes: Record<string, string> = {
    "data-view-text": prefs.textSize,
    "data-view-contrast": prefs.contrast,
    "data-view-motion": prefs.motion,
    "data-view-hints": prefs.hints,
    "data-view-nav": prefs.navLayout,
  };
  if (flags.highContrast) attributes[HIGH_CONTRAST_ATTR] = "";
  if (flags.still) attributes[STILL_ATTR] = "";
  return attributes;
}

/**
 * Скрипт до гидрации: «как в системе» → флаги по `matchMedia`, и следит за
 * сменой настройки системы, пока страница открыта. Тот же расчёт, что
 * `effectiveViewFlags`; `window.__wesetupViewSync()` пересчитывает после
 * смены выбора в клиенте.
 */
export function viewPrefsBootstrapCode(): string {
  return `(function(){try{var d=document.documentElement;var hc=window.matchMedia("(prefers-contrast: more)");var rm=window.matchMedia("(prefers-reduced-motion: reduce)");function sync(){var c=d.getAttribute("data-view-contrast");var m=d.getAttribute("data-view-motion");d.toggleAttribute("${HIGH_CONTRAST_ATTR}",c==="high"||(c==="auto"&&hc.matches));d.toggleAttribute("${STILL_ATTR}",m==="reduce"||(m==="auto"&&rm.matches));}sync();if(hc.addEventListener){hc.addEventListener("change",sync);rm.addEventListener("change",sync);}window.__wesetupViewSync=sync;}catch(e){}})();`;
}

/** id основного содержимого — цель ссылки «Перейти к содержимому». */
export const MAIN_CONTENT_ID = "main-content";
