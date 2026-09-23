# Evidence — location-tabs-2026-09

Дата: 2026-09-23. Стенд: dev http://localhost:3025, БД localhost:5432/wesetup_e2e.
Своя организация `e2e-org-loc` (3 точки: «лордлор», «hgjhghj», «Какая то там вторая точка ленина
10 допустим»), плюс `e2e-org-loc1` (одна точка) и `e2e-org-loc0` (две точки, флаг выключен).
Сетап: `.agent/tasks/location-tabs-2026-09/e2e/setup.ts` (идемпотентный, прогнан трижды).
На точке 1 «Закрыть день» по всем 4 журналам, на точке 2 — по двум, на точке 3 — ничего:
ожидаемые счётчики 4/4, 2/4, 0/4.

## Критерии приёмки

| AC | Статус | Доказательство |
|---|---|---|
| AC1 | PASS | `smoke.ts`: на /journals, /journals/hygiene, /settings/users при 360/390/768/1280 в светлой и тёмной теме строка «Точки» с 3 вкладками, `nav` выше хлебных крошек, `scrollWidth <= innerWidth` (например, 360: 360/360). На 390 строка листается вбок (`stripScrolls: true`), активная вкладка после переключения прокручена в видимую часть строки. Скриншоты `shots/journals-*.png`, `shots/settings-users-*.png`. |
| AC2 | PASS | `smoke.ts`: на /dashboard вкладки — первый видимый блок страницы, счётчики `["4/4","2/4","0/4"]` на всех 8 комбинациях ширина×тема. Тоны: 4/4 зелёный с галкой, 2/4 жёлтый, 0/4 красный (`shots/dashboard-1280-light.png`). `section[aria-label="Сводка по точкам"]` отсутствует, файл `locations-summary-strip.tsx` удалён. |
| AC3 | PASS | Пилюля удалена из шапки (десктоп и мобильная строка), `LocationSwitcherPill` удалён из `location-switcher.tsx` (grep: использований и `data-tour="location-switcher"` нет). `smoke.ts`: `headerPill = 0` на всех страницах, высота шапки на телефоне 73px. Переключение: с /journals на «hgjhghj» — после reload активна она; с /dashboard на третью точку — после reload активна она, подпись дашборда «2 из 4» → «0 из 4» (данные новой точки). Скриншоты `shots/switch-journals-390.png`, `shots/switch-dashboard-390.png`. |
| AC4 | PASS | `src/lib/today-compliance-close-day.test.ts` (3 теста, подменная Prisma): закрытие на точке A не зеленит B; общее закрытие ("") действует для всех точек; без `buildingId` поведение прежнее. До правки тест падал («закрытие точки A не зеленит точку B: true !== false»), после — зелёный. На стенде: счётчики 4/4, 2/4, 0/4 при закрытиях только на точках 1 и 2 (до правки были бы 4/4 у всех). |
| AC5 | PASS | `smoke.ts`: `e2e-org-loc1` (одна точка) и `e2e-org-loc0` (флаг выключен) — на /dashboard и /journals `nav[aria-label="Точки"]` отсутствует, пилюли нет. `shots/one-point-journals-390.png`, `shots/points-off-journals-390.png`. |
| AC6 | PASS | `smoke.ts`: `/dashboard` с кукой `ws-shell=mini` на 390 — `#mini-root` есть, 3 вкладки со счётчиками, `scrollWidth 390 <= 390`, строка в пределах экрана. `shots/mini-dashboard-390-*.png`. Верхняя строка мини-приложения и `/mini/me` не тронуты. |
| AC7 | PASS | `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` — 0 ошибок. `npx eslint` по изменённым файлам — 0 ошибок (5 старых warning в dashboard/page.tsx, не мои). `npx eslint src --quiet` — 15 ошибок только в чужих, не изменённых файлах (`scope-and-schedule-editors.tsx`, `task-fill-field.tsx`), новых нет. `npm test` — 1995/1995. Скриншоты 360/390/768/1280 × светлая/тёмная (32 шт.) в `shots/`. `.agent/tasks/locations-strip-mobile-2026-09/check.ts` адаптирован под вкладки и `e2e-org-loc` — PASS. Итог смоука: 178/178 PASS, ошибок страницы 0 (`e2e/smoke-result.json`). |

## Изменённые файлы

- `src/components/layout/location-tabs.tsx` — новый: `LocationTabs` (строка вкладок, счётчики,
  затухание краёв, центрирование активной, «Настроить точки») и `LayoutLocationTabs` (обёртка
  layout'а с `usePathname`, не рисует на /dashboard).
- `src/components/layout/location-switcher.tsx` — `useSwitchBuilding` экспортирован,
  `LocationSwitcherPill` удалён, `LocationSwitcherList` оставлен.
- `src/components/layout/header.tsx` — удалены пилюля точки на десктопе и мобильная строка под
  шапкой; список в мобильном меню остался. (Правилась рабочая копия; в индексе — чужой staged-откат.)
- `src/app/(dashboard)/layout.tsx` — `LayoutLocationTabs` над `PageNav`.
- `src/app/(dashboard)/dashboard/page.tsx` — `LocationTabs` со счётчиками первым блоком,
  `LocationsSummaryStrip` убран.
- `src/components/dashboard/locations-summary-strip.tsx` — удалён.
- `src/lib/today-compliance.ts` — фильтр `buildingKey in [closeEventBuildingKey(id), ""]` для
  закрытий дня при переданном `buildingId`.
- `src/lib/today-compliance-close-day.test.ts` — новый тест.
- `.agent/tasks/locations-strip-mobile-2026-09/check.ts` — адаптирован.
- `.agent/tasks/location-tabs-2026-09/e2e/{setup.ts,smoke.ts,state.json,smoke-result.json}`, `shots/`.

## Команды

```
npx tsx .agent/tasks/location-tabs-2026-09/e2e/setup.ts                      # OK
node --import tsx --test src/lib/today-compliance-close-day.test.ts          # до фикса 1 fail, после 3/3
NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck                     # 0 ошибок
npx eslint <изменённые файлы>                                                # 0 errors, 5 старых warnings
npx eslint src --quiet                                                       # 15 старых ошибок в 2 чужих файлах
npm test                                                                     # 1995/1995 pass
npx tsx .agent/tasks/location-tabs-2026-09/e2e/smoke.ts                      # 178/178 PASS
npx tsx .agent/tasks/locations-strip-mobile-2026-09/check.ts                 # PASS
```

## Открытые вопросы

- `npm run lint` без аргументов линтит и каталог сборки dev-стенда `.next-e2e/` (не в ignore) и за 20+ минут не завершился — остановил свой процесс, вместо него прогнан `npx eslint src --quiet`.

- В оболочке Mini App тема ведётся своим провайдером (профиль → устройство → Telegram), поэтому
  `mini-dashboard-390-light.png` тоже тёмный — это поведение оболочки, не вкладок.
- В первом прогоне смоука были 2 `pageerror` Turbopack HMR («module was instantiated … deleted»)
  в `pin-requests-panel.tsx` и `journal-doc-guide.tsx` — горячая перезагрузка из-за правок
  параллельных исполнителей; во втором прогоне 0 ошибок.
- Существующая особенность `getTemplatesFilledToday`: без активных ежедневных документов функция
  возвращается раньше и закрытия дня не учитывает вовсе. Не трогал (вне спецификации).
