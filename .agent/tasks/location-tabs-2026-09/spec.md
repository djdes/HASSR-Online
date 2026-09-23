# Точки — горизонтальные вкладки сверху

TASK_ID: location-tabs-2026-09
Дата: 2026-09-23. Статус: frozen.
План-источник: `C:\Users\Yaroslav\.claude\plans\1-distributed-nautilus.md`, раздел B.

## Запрос владельца

«Точки сегодня визуально как-то странно. Я бы написал что-то вроде «Выберите точку», иконку,
что это места, и без прогрессбара, а как-то по-другому. Визуально, может, вообще их
горизонтальными вкладками! В линию со скролом вбок, думаю, стоит попробовать как раз сверху, и
выпадающий не нужен будет.»

Решение владельца по статусу во вкладке: **счётчик «1/34»**. Цвет: красный при заполненности
< 50 %, жёлтый < 100 %, зелёный с галкой при 100 % (пороги из
`locations-summary-strip.tsx` L62–68).

## Как сейчас

- Блок «Точки сегодня» — `src/components/dashboard/locations-summary-strip.tsx`
  (вертикальные карточки с полоской, только `/dashboard`, только руководству). Смонтирован в
  `src/app/(dashboard)/dashboard/page.tsx` L335. Данные `locationItems` — L271–296.
- Пилюля-выпадашка точки в шапке — `LocationSwitcherPill`
  (`src/components/layout/location-switcher.tsx` L48–126). Рисуется в
  `src/components/layout/header.tsx`: десктоп L405–413, отдельная строка на телефоне
  L877–891.
- Список в мобильном меню — `LocationSwitcherList` (L129–171), в `header.tsx` L546–556.
- Переключение — `POST /api/me/active-building` → cookie → `router.refresh()` (хук
  `useSwitchBuilding`, L21–46).
- Шапка получает `buildings` и `activeBuildingId` из `src/app/(dashboard)/layout.tsx` L378–379
  (`buildingContext.canSwitch`).

## Что сделать

1. Новый клиентский компонент `src/components/layout/location-tabs.tsx`:
   - Eyebrow: иконка `MapPinned` (lucide) и «Выберите точку»
     (`text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]`). Если переданы
     счётчики — справа «заполнено сегодня» (`text-[12px] text-[#9b9fb3]`).
   - Одна строка вкладок со скроллом вбок: `flex flex-nowrap gap-2 overflow-x-auto`, скрытый
     скроллбар, мягкое затухание краёв через mask-image, только когда есть что прокручивать.
   - Активная вкладка при монтировании прокручивается в центр (приём
     `src/components/qr-fill/quick-switch.tsx` L35–41).
   - Вкладка — `button` высотой 44px (`h-11`), `rounded-2xl`, `px-3.5`, внутри:
     - иконка `Store`;
     - название (`max-w-[220px] truncate`, `title` = «название, адрес»);
     - счётчик `filled/total` (`tabular-nums text-[12px] font-semibold`, пилюля по тону;
       100 % — зелёная с `Check`), если передан.
   - Активная вкладка: `bg-[#5566f6] text-white border-[#5566f6]`, счётчик на
     `bg-white/20 text-white`. Остальные: белые, `border-[#dcdfed]`,
     `hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]`. Переходы 150 мс, focus-visible
     `ring-4 ring-[#5566f6]/15`.
   - Переключение: `useSwitchBuilding` (экспортировать из `location-switcher.tsx`),
     `Loader2` на нажатой. Клик по активной — ничего.
   - Полному доступу в конце строки — иконка-кнопка «Настроить точки» (`Settings2`) на
     `/settings/buildings`.
   - Разметка — `<nav aria-label="Точки">`, у активной `aria-current="true"`. **Не**
     `role="tablist"`: `globals.css` L1063–1070 на телефонах (`.app-shell [role=tablist]`)
     переносит такие ряды.
   - Меньше двух точек — `null`.
2. `src/app/(dashboard)/layout.tsx`: над `PageNav` (внутри `<main>`, L422–427) выводить
   вкладки без счётчиков для всех страниц кабинета, **кроме `/dashboard`**. Клиентская
   обёртка решает по `usePathname()`, на дашборде вкладки рисует сама страница.
   - Данные: `buildingContext.canSwitch ? buildingContext.buildings : []`,
     `activeBuildingId`, `manageHref` полному доступу.
   - Не липкие, прокручиваются со страницей.
3. `src/app/(dashboard)/dashboard/page.tsx`: `<LocationsSummaryStrip items={locationItems} />`
   (L335) заменить на `<LocationTabs … counters>` и поставить **первым видимым элементом
   страницы**, до `QuickStartCard`. Файл `locations-summary-strip.tsx` удалить.
4. `src/components/layout/header.tsx`:
   - убрать `LocationSwitcherPill` на десктопе (L405–413) и мобильную строку (L877–891);
   - `LocationSwitcherList` в мобильном меню оставить;
   - `LocationSwitcherPill` удалить из `location-switcher.tsx`, если больше нигде не
     используется (проверить grep'ом, включая `data-tour="location-switcher"`).
5. Баг в счётчиках точек: `src/lib/today-compliance.ts` L776–786 учитывает закрытие дня
   («Закрыть день») без фильтра по точке, поэтому закрытие на точке A засчитывается и точке B.
   - Когда в `getTemplatesFilledToday` передан `buildingId`, фильтровать
     `buildingKey: { in: [closeEventBuildingKey(buildingId), ""] }` (как в
     `getActiveCloseEvent`, `src/lib/journal-close-events.ts` L187–215).
   - Без `buildingId` поведение не менять.
   - Тест.
6. Mini App: у руководства домашняя — `/dashboard` в оболочке мини-приложения, вкладки со
   счётчиками придут туда сами. Проверить на 390px, что строка не ломает оболочку. Верхнюю
   строку мини-приложения и `/mini/me` не трогать.
7. «Что нового» (`src/lib/whats-new-notes.ts`), категория «Интерфейс»: «Точки — вкладками
   сверху на всех страницах: видно, сколько журналов заполнено на каждой». SHA обновлю сам.

## Критерии приёмки

- AC1. При двух и более точках на всех страницах кабинета (кроме `/dashboard`) над хлебными
  крошками строка «Выберите точку» со вкладками. Строка листается вбок, страница на 360px вбок
  не уезжает (`scrollWidth <= innerWidth`).
- AC2. На `/dashboard` первой идёт строка вкладок со счётчиками «N/M» и тонами по порогам.
  Старого блока «Точки сегодня» с полосками нет.
- AC3. В шапке (десктоп и телефон) выпадающей пилюли точки нет. Переключение вкладкой с
  `/journals` и с `/dashboard` меняет активную точку (данные страницы после refresh — для
  новой точки).
- AC4. «Закрыть день» на точке A не меняет счётчик точки B (юнит-тест на
  `getTemplatesFilledToday` с двумя точками).
- AC5. При одной точке или выключенных точках вкладок нет нигде.
- AC6. Mini App руководителя (`/dashboard` в оболочке) показывает вкладки, ничего не
  переполняется на 390px.
- AC7. `npm run typecheck` (с `NODE_OPTIONS=--max-old-space-size=8192`), `npm run lint` без
  новых ошибок, `npm test` — зелёные. Скриншоты 360/390/768/1280 в светлой и тёмной теме
  кабинета. Проверка `.agent/tasks/locations-strip-mobile-2026-09/check.ts` адаптирована и
  зелёная.

## Ограничения

- Дизайн-система (`.claude/skills/design-system`): индиго `#5566f6`, `rounded-2xl`, lucide,
  без эмодзи, цели касания 44px.
- Не трогать логику cookie точки, API `active-building`, `building-scope.ts`.
- Коммит только с явными путями (в индексе устаревшая версия `header.tsx`).
- Временные файлы — в scratchpad на C:.
