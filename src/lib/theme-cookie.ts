/**
 * Тема кабинета на ЭТОМ устройстве — в куке, чтобы сервер рисовал первый
 * кадр сразу в ней.
 *
 * Зачем: выбор темы живёт в localStorage устройства (светлая, тёмная,
 * «как на устройстве», смена по времени суток), а сервер его не видит и
 * рисовал страницу в теме из профиля (`User.themePreference`). Когда они
 * расходились — профиль менялся с телефона, днём в профиле оставалась
 * «ночная» тёмная, «как на устройстве» у ноутбука и телефона разное, —
 * каждая загрузка, `router.refresh()` и переход в другой раздел на кадр
 * показывали чужую тему.
 *
 * В куке лежит действующая тема (светлая/тёмная), которую устройство
 * сейчас показывает. Пишут её скрипт до гидрации и `applyThemeToDOM`
 * (`components/theme/site-theme.tsx`), читает сервер (`site-theme.server.ts`).
 * Модуль без React и без `window` — его берут и сервер, и клиент, и тест.
 */

export type ThemeValue = "light" | "dark";

export const THEME_COOKIE = "wesetup-theme";

/** ~400 дней — дольше куку браузеры всё равно не хранят. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

export function parseThemeCookie(value: string | null | undefined): ThemeValue | null {
  return value === "light" || value === "dark" ? value : null;
}

/** Строка для `document.cookie`. */
export function themeCookieString(theme: ThemeValue): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Тема первой отрисовки: тема этого устройства (кука), иначе тема профиля
 * (новое устройство — первый заход), иначе светлая.
 */
export function pickInitialTheme(
  cookieValue: string | null | undefined,
  profileTheme: string | null | undefined,
): ThemeValue {
  return parseThemeCookie(cookieValue) ?? (profileTheme === "dark" ? "dark" : "light");
}
