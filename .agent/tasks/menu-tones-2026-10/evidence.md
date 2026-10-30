# Evidence — живые иконки и меню, вариант C

Сборщик: сессия Claude Code, 29.10.2026. Спека: `spec.md` (заморожена до реализации).
Локальный запуск для скриншотов: Postgres 16 (локальная копия), `prisma db push`, `prisma/seed.ts` +
`prisma/seed-haccp-demo.ts`, `next dev -p 3100`, Playwright (Chromium), владелец демо-организации,
DPR 2. Скриншоты — `raw/` (PNG локально, в git не идут по `.gitignore` `.agent/**/*.png`; список и замеры — `raw/screenshots.txt`).

| AC | Вердикт | Доказательства |
|----|---------|----------------|
| AC1 палитра | PASS | `src/lib/nav-tones.ts` (иконка → один из 9 тонов); переменные `[data-tone]` светлой и тёмной темы в `src/app/app-theme.css`; `src/lib/nav-tones.test.ts` — 4 теста: тон у каждой иконки `NAV_ICONS` и карточек настроек, имена в `NavIconChip name="…"` есть в карте иконок, соседи в видимых меню 7 ролей × 3 набора фактов разного цвета |
| AC2 сайдбар C | PASS | `src/components/layout/app-sidebar.tsx`, `section-menu-list.tsx` (`NavBadge`, `NavChevron`); `raw/sidebar-main-*.png`, `raw/sidebar-company-*.png`, `raw/sidebar-points-*.png`; замер выбранного «Оборудования»: фон `rgb(233,244,250)`, текст `rgb(10,106,161)`, полоска `rgb(10,134,201)` 3px |
| AC3 без знака внизу | PASS | `brandMark` и проп `whiteLabel` удалены из `AppSidebar`; `aside [data-sidebar-brand-mark]` — 0 элементов в светлой и тёмной теме (замер Playwright) |
| AC4 анимации | PASS | `app-theme.css`: `[data-nav-chip]`, `[data-nav-row]`, `[data-nav-rise]`, `[data-motion]`, `[data-tone-button]`, ключевые кадры, блок `prefers-reduced-motion`; замер наведения: `translate 0px -1px`, `scale 1.06`, `rotate -6deg`, `transition-property: translate, scale, rotate, box-shadow` (правило `.app-shell *` перебито); `raw/sidebar-hover-light.png`; меню раздела пересобирается по `key` и появляется каскадом |
| AC5 другие меню | PASS | лист на телефоне и меню Mini App (`SectionMenuList`/`NavSectionsList`), «Разделы» Mini App (`sections-client.tsx`), меню и лист профиля (`header.tsx`, `profile-sheet.tsx`), ⌘K (`command-palette.tsx`), выбор избранного (`search-pick-dialog.tsx`), карточки настроек (`settings-card-grid.tsx`; `iconClass`/`bgClass` убраны из `settings-cards.ts`), колокольчик (`notifications-bell.tsx`), кнопки шапки и аватар; `raw/profile-menu-light.png`, `raw/command-palette-light.png`, `raw/more-cards-light.png`, `raw/favorites-picker-light.png` (72 плашки), `raw/mobile-sheet-*.png` |
| AC6 главная | PASS | `BrandLogo gradient` (`--app-wordmark-gradient`), подпись — SVG `textLength` (`src/lib/wordmark-tagline.ts` + тест), равнение по буквам знака `WORDMARK_INK` (`src/components/brand/logo.test.ts` сверяет с `wordmark.png`). Замер 1440: буквы 674.6–1021.3 px, подпись 675–1021 px, центр пары = центр контента (848 px); 390: буквы 88.8–301.9, подпись 88–301; горизонтальной прокрутки нет. White-label ветка (название партнёра + обычная подпись) не тронута; под акцентом партнёра градиент «Начальной настройки» снимается (`[data-home-setup]`). `raw/home-1440-*.png`, `raw/home-390-*.png` |
| AC7 тёмная тема | PASS | `raw/*-dark.png`; тёмные значения тонов; подпись в тёмной теме `rgb(163,173,255)` (`--app-wordmark-tagline`; хекс-класс перекрашивался глобальным правилом — заменён переменной) |
| AC8 проверки | PASS | `npm run typecheck` — exit 0; `npm run test:gate` — pass=5102, fail=0; `npx eslint` по 21 изменённому/новому файлу — exit 0; `npm run i18n:check` — pass 97, fail 0 |
| AC9 скриншоты | PASS | `raw/` — 19 PNG (см. `evidence.json`) |

## Найдено и исправлено по ходу
- У «Выйти» рисовались квадратики: `LogOut` и `Languages` не было в `NAV_ICONS`, `navIcon` подставлял
  запасную иконку. Добавлены в карту; тест «иконки плашек, названные в коде, есть в карте» ловит это.
- Подпись была шире видимых букв на 12%: у `wordmark.png` прозрачные поля (3.2% слева, 8.3% справа).
  Подпись равняется по буквам, пара сдвинута на 2.5% — буквы стоят ровно по центру.
- Каскад с `fill-mode: both` замораживал сдвиг строки при наведении — заменён на `backwards`.
- Общее тёмное правило `body:is(…) [data-tone]` перебило бы тона внутри `.app-shell` — каждый тон своим
  правилом одной специфичности.

## Не проверено глазами
- «Разделы» в Mini App (нужен вход через Telegram) — по коду: тот же `NavIconChip`, имена иконок из модели меню.

## Что нового (текст для заметки, если нужен)
«Меню стало цветным: у каждого раздела своя плашка, выбранный пункт подсвечен его цветом. На главной —
знак „сетап“ с градиентом, как на визитке».
