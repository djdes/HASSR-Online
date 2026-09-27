# Plan — mini-theme-tiles-2026-09

Spec: `spec.md` (frozen). Ветка `feat/mini-theme-tiles-2026-09-27`.

## Решения до кода
- **Хранение «Как на устройстве» — как у сайта, без БД.** Сайт держит `system` только в localStorage
  (`wesetup-theme-mode=system`, `wesetup-theme-auto-schedule=0`, `wesetup-app-theme=<действующая>`), а в
  профиль (`/api/me/theme`) шлёт действующую светлую/тёмную. Мини-приложение делает то же самое → `/api/me/theme`
  и схема не меняются, серверная подстановка `initialTheme` не трогается.
- **Порядок выбора темы в Mini App:** смена по времени (ключ `…-auto-schedule=1`) → «как на устройстве»
  (`…-theme-mode=system`) → тема профиля → выбор на устройстве → тема Telegram → по умолчанию. Первые два —
  настройки этого устройства (как на сайте, где localStorage главнее профиля); остальное — как было.
- **«Как на устройстве»:** в Telegram — `WebApp.colorScheme` + событие `themeChanged`; вне Telegram
  (приложение WeSetup, браузер) — `prefers-color-scheme` + `change`. Смена сама по себе пишет действующую тему
  в localStorage и профиль — как сайт.
- **Карточки:** из `theme-tiles.tsx` выносится презентационная группа (`ThemeTileGroup`: `value`/`onChange`,
  стрелки, подсказка про время суток) и хук выбора `useThemeTileChoice(source)`; сайт собирается из них же
  (разметка и классы прежние). В Mini App — `MiniThemeTiles` на `useMiniTheme()`.
- **Оболочка приложения (страницы сайта внутри Mini App):** `MiniThemeProvider` отдаёт `useSiteTheme()` мостом —
  «Настройки → Внешний вид» в приложении управляет той же темой, что и профиль (иначе «Как на устройстве»
  там схлопывался бы в светлую/тёмную и спорил с `/mini/me`).
- **«Внешний вид · логотип и цвета»** → ссылка «Логотип и цвета» под карточками, как на сайте:
  `BRANDING_SETTINGS_HREF`, только с `admin.full` (как `canEditBranding` сайта). Строку списка убрать.

## Шаги
1. `theme-tiles.tsx`: `ThemeTileGroup` + `useThemeTileChoice(source)` + размер `touch`; сайт — через них.
2. `mini-theme-model.ts` (чистая логика: ключи, порядок, действующая тема, записи выбора, код bootstrap) + тесты.
3. `mini-theme.tsx`: режим/авто/действующая, Telegram `themeChanged`, `prefers-color-scheme`, мост в сайт.
4. `mini-theme-tiles.tsx` + `me-client.tsx` (карточки, ссылка «Логотип и цвета», без старой переключалки).
5. Поиск других переключалок (Mini App, киоск, мобильная оболочка) — заменить или записать.
6. Проверка: typecheck, npm test, e2e на :3132 (360×800, 1280, Telegram-эмуляция), скриншоты, evidence.
