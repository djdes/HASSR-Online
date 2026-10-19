# pages-points-2026-10 — evidence

Ветка `feat/pages-points` от `integ/sketch-wave` `76c01cc4`, рабочая копия `D:\wt\pages-points`, база
`wesetup_pages_points` (127.0.0.1:5432), dev-сервер на 3072 (остановлен после проверок). Вход демо:
`admin@haccp.local` / `admin1234` (пароль подошёл, не менялся), `chef@haccp.local`, `hotcook1@haccp.local`.
Полный прогон браузера — 18.10.2026 16:20–16:30 на текущем коде (после него `src/` не менялся: проверено
`find src -newer raw/tsc.txt` — пусто).

## Итог по критериям

| AC | Вердикт | Доказательство |
|----|---------|----------------|
| AC1.1 источник пунктов в модели | PASS | `src/lib/app-nav.ts`: `NavMenuGroup.source?: "buildings"`, `NAV_MENU_SOURCES`, `sourceMenuItems`; `POINTS_MENU` — `myPoints` (source + «add» `/settings/buildings/new`), `allPoints`, `more`; статические `href` без `[`/`]` — тест «статическая модель без динамических сегментов…» (`raw/tests-nav.txt`) |
| AC1.2 подстановка на сервере, тот же список точек | PASS | `visibleNav(actor, facts, data)`, `buildNavModel({ menuData })`, `loadNavMenuData` → `listPersonBuildings` (`active-building.ts`: порядок переключателя + `User.buildingIds`); три места сборки модели (layout сайта, оболочка Mini App, `/mini/sections`). Браузер: сайдбар 1440, лист бургера 390, лист Mini App и ⌘K показывают точки (`raw/results-menu.json`, `menu-*-sheet.png`, `menu-*-palette.png`) |
| AC1.3 активный пункт | PASS | `activeMenuItemId` + `useSectionPlace`; тест «активный пункт…»; браузер у руководителя и заведующей: `/settings/buildings/<id>` → пункт точки, `/new` → «add», `/settings/buildings` → «buildings», `/settings/equipment` → «equipment»; клик по «Берёзка на Мира» в меню → её страница и подсветка (`raw/playwright-run.txt`) |
| AC1.4 нет точек / чужие | PASS | тесты «точек нет — только «+ Добавить точку»», «в меню только точки, доступные человеку» (фильтр `User.buildingIds`, повар — раздела нет); удалённая точка пропадает из меню (`results-edit.json` `afterDelete.menu`) |
| AC1.5 тесты | PASS | `src/lib/app-nav.test.ts` (+5 тестов, `menuShape("points")` обновлён), `src/lib/point-wizard.test.ts` (5) — 85/85 вместе с соседними (`raw/tests-nav.txt`) |
| AC2.1 guard / 404 | PASS | `[id]/page.tsx`: `hasFullWorkspaceAccess(` → иначе `redirect("/journals")`; точка не из `listPersonBuildings` или не своей организации → `notFound()`; тест сверяет guard страницы точки с правилом источника; повар → уведён (`results-cook.json`) |
| AC2.2 заголовок и блоки 1–5 | PASS | `SectionPageHeader title=<точка>`, пояснение — адрес; блоки `head, rooms, equipment, uv, qr, delete` у обеих точек на 1440 и 390 (`results-pages.json`, `page-*-lenina/mira.png`); правка окном через PATCH — переименование видно в меню, КПП и телефон показаны (`results-edit.json`, `edit-1/2*.png`); помещение добавлено 7 → 8; окно «Добавить УФ-лампу» открывается с типом «УФ-лампа» и этой точкой (`edit-3-uv-dialog.png`); ресурс и наработка ламп — полоса и «осталось …» (`wizard-5-point-page.png`); QR — число наклеек и ссылки `/settings/qr-posters?kind=equipment&layout=sheet&ids=…` и `?kind=rooms&ids=…` |
| AC2.3 удаление точки | PASS | `ConfirmDialog` variant danger, `typeToConfirm` = название, три последствия; кнопка неактивна до ввода (`confirmDisabledBeforeTyping: true`), после — DELETE существующего API, переход на обзор, точки нет в меню (`edit-4-delete-dialog.png`, `edit-5-after-delete.png`) |
| AC2.4 телефон 390 | PASS | `overflow: 0` на всех страницах 390 у руководителя и заведующей; блоки в одну колонку (`page-*-390-*.png`) |
| AC3.1 мастер по шагам | PASS | `/settings/buildings/new`, guard `hasFullWorkspaceAccess(`; шаги 1–4 с номером и полосой; пустое и занятое название не пускают дальше (тексты ошибок в `results-wizard`/`results-menu-pages-wizard-edit-cook.json`); типовой набор галочками с «Основным производством» и своим помещением; «Как в другой точке» (`wizard-2-rooms-copy.png`); оборудование с количеством и помещением; итог «Что будет создано» (`wizard-1…4*.png`) |
| AC3.2 существующие API, ошибки тостом | PASS | создание: POST точки → POST помещений (или `copy-rooms`) → POST оборудования с `roomId`; неудачный шаг не отменяет созданное — тост «не добавилось: …», переход на страницу точки (`point-wizard-client.tsx`) |
| AC3.3 переход и меню | PASS | после «Создать точку» — страница новой точки, пункт в меню подсвечен, точка последняя в «Мои точки» (`results-…json` → `wizard.menu`, `wizard-5-point-page.png`); создано 7 помещений, 4 единицы оборудования, 1 УФ-лампа |
| AC3.4 кнопка в шапке обзора | PASS | `data-add-point-header` → `/settings/buildings/new` на обзоре у обеих ролей (`results-pages.json`, `page-*-overview.png`); нижняя кнопка — тоже в мастер |
| AC4.1 «Открыть точку» на обзоре | PASS | `data-open-point` у обеих карточек; тумблер «Вести журналы отдельно по точкам» на месте (`page-headchef-1440-overview.png`) |
| AC5.1 подписи и иконки | PASS | `navigation.shell.menus.points.groups.myPoints/allPoints`, `items.add`, `shell.point.open/addHint`, `settingsManagement.points.*` — RU/EN/UZ, EN/UZ без кириллицы (`navigation-localization.test.ts`, `npm run i18n:check` 82/82 — `raw/i18n-check.txt`); иконка `Plus` в `nav-icons.ts` (тест иконок учитывает источник) |
| AC5.2 права | PASS | заведующая видит раздел, точки и страницы (1440/390/Mini App); повар: раздела нет в модели (тест), прямой заход на `/settings/buildings/<id>`, `/new`, `/settings/buildings` → уведён на `/mini/today` (`results-cook.json`) |
| AC5.3 тесты меню | PASS | `app-nav`, `settings-cards`, `navigation-localization` (lib и layout), `no-settings-hub-links` + `header-point`, `building-scope`, `room-kinds`, `area-building`, `point-wizard` — 85/85 (`raw/tests-nav.txt`) |
| AC6.1 общие проверки и Playwright | PASS | `tsc -p tsconfig.typecheck.json` exit 0 (`raw/tsc.txt`); ESLint 19 изменённых файлов — 0/0 (`raw/eslint.txt`); Playwright 45 проверок, 0 проблем (`raw/playwright-run.txt`); скриншоты — `raw/*.png` и копия `C:\Users\Two\wesetup-backup-2026-10-17\pages-shots\points\` (53 файла); verify-worktree `corrupted: 0`, scan-corrupt `corruptModifiedByAgent: 0`, `corruptUntracked: 0` |
| AC6.2 «Что нового» | PASS | предложение ниже (`whats-new-notes.ts` не менялся) |

## Предложение «Что нового» (для руководителя)

> **Торговые точки.** Каждая точка теперь — свой пункт в меню «Торговые точки» со страницей: название и адрес для
> документов, помещения, оборудование, УФ-лампы с остатком ресурса и печать QR-наклеек этой точки. Новую точку
> заводит мастер «+ Добавить точку»: адрес, типовые помещения и оборудование — за четыре шага.

## Решения по ходу

См. `decisions.md` (11 пунктов и 2 наблюдения). Коротко: модель меню — `source` у группы + `NAV_MENU_SOURCES`;
список точек — `listPersonBuildings` (как у переключателя, с `User.buildingIds`, независимо от тумблера);
подписи групп «Мои точки» / «Все точки»; кнопка «+ Добавить точку» в шапке без точек ведёт в мастер; прежняя
форма «Новая точка» на обзоре заменена мастером; у окна оборудования — `defaultType`/`triggerLabel`; страница
точки не переключает текущую точку журналов в шапке.

## Окружение и данные

- Прогоны: `check.mjs` (сценарии menu, pages, wizard, edit, cook), `console-check.mjs` (ошибки консоли — только
  предупреждение гидратации `<html style>` от Telegram WebApp в оболочке Mini App, есть и на нетронутой
  `/settings/areas`).
- Мастер дважды создавал «Точку проверки …», сценарий edit её переименовал и удалил через интерфейс. Остатки первого
  прогона (цеха «Без точки» с оборудованием) убраны из своей базы, журнал фритюра пересинхронизирован
  (`syncFryerOilDocuments`). Остатки последнего прогона (цеха «Без точки» удалённой точки «Точка проверки 132702 ред»)
  в своей базе остались: к 19.10 сервер PostgreSQL на 127.0.0.1:5432 перестал слушать порт, убрать их не удалось —
  на результат не влияют.
- Диск D: перед коммитом 19.10 `verify-worktree` нашёл 32 испорченных неизменённых отслеживаемых файла (не из этой
  задачи, например `building-group-header.tsx`, `register-document.ts`) — восстановлены `--restore` из HEAD,
  повторная проверка `corrupted: 0`; `scan-corrupt` — `corruptModifiedByAgent: 0`, `corruptUntracked: 0`.
  Tsc и тесты после восстановления прогнал pre-commit hook.
