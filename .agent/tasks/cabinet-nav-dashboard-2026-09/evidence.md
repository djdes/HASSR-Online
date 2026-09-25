# Evidence: cabinet-nav-dashboard-2026-09

Проверено 2026-09-25 на локальном dev (`next dev -p 3040`, база `wesetup_wt_ui`),
организация e2e `e2e-nav-dashboard-org` (`e2e/seed.ts`: гигиена — документ месяца
**закрыт**, фритюр — действующий документ, остальные журналы без документов).
E2E: `e2e/verify.ts` → `raw/e2e-results.json`; скриншоты `shots/*.jpg` (локально, в
git не попадают — `.gitignore: .agent/**/*.jpg`).

## AC1 — меню — PASS
- `src/lib/app-sections.ts`: пять разделов (`/batches`, `/changes`, `/losses`,
  `/competencies`, `/bonuses`) убраны из `APP_SECTIONS` (шапка сайта + «Разделы»
  мини-приложения) и из `HEADER_NAV_HREFS`; список зафиксирован `MENU_HIDDEN_HREFS` +
  тест «убранные из меню разделы не возвращаются…». Командная палитра — пункты удалены.
- `src/components/layout/header.tsx`: мобильное меню — строка организации + шестерёнка
  справа (`/settings`), отдельной строки «Настройки» нет; «Сотрудники» над «Журналы»;
  строки 52px, шрифт 17px, иконки 24px. Десктоп: шестерёнка сразу у пилюли организации
  (перенесена из правого кластера), «Сотрудники» первым пунктом в меню под пилюлей.
- e2e: `desktopMenu.items` = Сотрудники, Журналы, Производственный план, Нарушения,
  Отчёты, Идеи; `hiddenPresent: []`, `gearHref: "/settings"`, зазор до пилюли 4px.
  `mobileMenu`: `hiddenPresent: []`, `settingsRowPresent: false`,
  `gear.sameRowAsOrg: true`, `staffBeforeJournals: true`, все строки `h: 52`,
  `font: 17px`, `icon: 24`. Палитра: 0 совпадений по пяти названиям (проверка
  «Отчёты» = 1). Страницы по адресу: все пять → 200, без редиректа.
- Скриншоты: `ac1-mobile-menu-390-light.jpg`, `ac1-mobile-menu-390-dark.jpg`,
  `ac1-desktop-menu-1440-light.jpg`.

## AC2 — карточка «Обязательные журналы» — PASS
- `DashboardSection` получил режим `centered` (сетка «угол | заголовок | угол»);
  подпись «Есть запись за сегодня…» и кнопки «Закрыть день»/«Выборочно» убраны.
- `close-day-card.tsx`: «Автозаполнить» → `ConfirmDialog` (на телефоне лист снизу, на
  десктопе окно) с текстом владельца и SVG «Было → Стало» на токенах темы; запускает тот
  же `POST /api/dashboard/close-day`. «QR-коды» → `/settings/qr-posters`. Текст и тост
  вынесены в `src/lib/journals-autofill.ts` (+3 теста).
- e2e 1440: `layout: centered`, `textAlign: center`, смещение центра заголовка от
  центра карточки 0px, заголовок «Обязательные журналы 0/45», кнопки
  `["Автозаполнить","QR-коды"]`, старых подписей нет. Шторка: заголовок «Автозаполнить
  журналы?», текст совпадает дословно, 2 SVG-бланка. Запуск: `POST close-day → 200`,
  тост «Заполнено: 7 журналов, 140 отметок, создано 6 документов · По 25 сентября…».
  Клик «QR-коды» → `/settings/qr-posters`.
- e2e 390: смещение центра 0px, кнопки 158×44 в ряд, горизонтального скролла нет;
  шторка прижата к низу экрана во всю ширину (`bottomAligned: true`, 390px).
- Скриншоты: `ac2-card-1440-light.jpg`, `ac2-card-390-light.jpg`,
  `ac2-autofill-sheet-1440-light.jpg`, `ac2-autofill-sheet-390-light.jpg`,
  `ac2-autofill-toast-1440-light.jpg`, `ac2-dashboard-1440-dark.jpg`,
  `ac2-dashboard-390-dark.jpg`.

## AC3 — раздел QR-кодов — PASS
- Причина «пропавшей гигиены»: общий экран брал журналы из `listHubJournals` — только с
  **действующим** документом на сегодня (или с истёкшим прошлым периодом). Журнал с
  закрытым документом текущего месяца или без документов вовсе на странице не было.
- Исправление: `src/lib/qr-posters-overview.ts` (`planQrOverview`, +5 тестов) — все
  включённые журналы (активные шаблоны минус выключенные, как на главной); гигиена
  объединяет QR здоровья, как в `health-qr-flow`. `qr-posters-view.ts` строит группы:
  универсальные («Все журналы», «Допуск сотрудников к смене» — отдельными карточками,
  отмечены), журналы (основной QR каждого), объекты (QR журналов холодильников / складов /
  ламп + наклейки). Карточка сама пишет состояние документа («закрыт…», «создастся при
  первом скане»).
- Было/стало на e2e-организации (`raw/qr-list-before-after.json`): раньше 1 журнал
  (`fryer_oil`), гигиены нет; теперь 41 журнал + 3 журнала объектов, гигиена есть,
  «Допуск» есть (45 включённых шаблонов = 41 + 3 + здоровье внутри гигиены).
- e2e: секции `main, journals, objects`; `mainCards: 2` (Все журналы, Допуск),
  `journalsRows: 41`, `journalsHasHygiene: true`, `objectsRows: 3`. Печать и форматы —
  прежние компоненты (`QrMainCard`, `QrCompactRow`, `JournalSelectionBar`).
- Скриншоты: `ac3-qr-1440-light.jpg`, `ac3-qr-journals-1440-light.jpg`,
  `ac3-qr-1440-dark.jpg`.

## AC4 — тёмная тема, выпадающие списки — PASS
- Причина: в тёмной теме перекрашивались базовые классы (`bg-white`, `text-[#0b1024]`),
  но не их варианты состояний. Пункты меню (`MENU_ITEM_CLASS`:
  `focus:bg-[#f5f6ff] data-[highlighted]:bg-[#f5f6ff]`) под курсором получали светлую
  плашку #f5f6ff под светлый текст #f2f3fb — контраст ≈1:1 (текст невиден).
- Исправление: общие примитивы берут токены (`menu-styles.ts`, `select.tsx`,
  `dropdown-menu.tsx`: `bg-[var(--app-tint-indigo)]` и т. п.); в `app-theme.css`
  страховка для всех хекс-вариантов состояний, найденных в коде (`hover:/focus:/
  focus-visible:/active:/data-[highlighted]:/data-[state=…]:` для светлых фонов и
  `hover:text-[#0b1024]` и др.). Меню разделов в шапке переведено с shadcn-серых на
  токены дизайн-системы.
- e2e (1440, тёмная, реальные hover мышью и фокус стрелками): меню профиля — все пункты
  8.13:1, «Выйти» 5.21:1; меню разделов под пилюлей — 7.05:1; дописанные на месте
  вызова классы (`focus:bg-[#f5f6ff]`, `data-[highlighted]:bg-[#f5f6ff]`,
  `hover:bg-white hover:text-[#0b1024]`, `hover:bg-[#f5f6ff] hover:text-[#0b1024]`) —
  8.13:1, красный `focus:bg-[#fff4f2] focus:text-[#a13a32]` — 5.21:1.
- Скриншоты: `ac4-profile-menu-hover-1440-dark.jpg`, `ac4-nav-menu-hover-1440-dark.jpg`,
  `ac4-variants-hover-1440-dark.jpg`.

## AC5 — проверки — PASS
- `npm run typecheck` — exit 0 (`raw/typecheck.log`).
- `npm test` — 2217/2217 pass, 0 fail (`raw/npm-test-summary.txt`).
- e2e со скриншотами 390 и 1440, светлая и тёмная — выше.

## Замечания (не блокируют)
- Dev-индикатор Next «1 Issue» на главной — давнее расхождение гидратации кнопки
  «Профиль» (`useIsNarrowViewport`: на сервере `DropdownMenuTrigger`, на телефоне
  `Button`), к этой задаче не относится (`e2e/probe-console.ts`).
- Production-сборку не запускал (запрет по диску; её делает оркестратор при интеграции).
