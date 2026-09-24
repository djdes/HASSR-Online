# Evidence — мастер-кабинет справочников (часть A: A1 + A2)

Ветка `feat/master-cabinet`, worktree `C:/wt/ws-a`, база `wesetup_wt_a`.
A1 (бэкенд) — коммит `dd7c9c4b`, его интеграционный прогон: `e2e/a1-integration.ts` (18/18).
A2 (интерфейсы) — этот отчёт; браузерный e2e: `e2e/a2-browser-e2e.ts`, результат `e2e/a2-results.json` (14/14 проверок PASS).

## Что сделано в A2
- `/settings/master-cabinet` (`src/app/(dashboard)/settings/master-cabinet/page.tsx`, `src/components/settings/master-cabinet-client.tsx`):
  PageGuide (3 шага + Q/A), блок «Код справочника» (код крупно, «Скопировать», объекты с кодом, раскрывающееся
  «Подключиться к коду другой организации» — переиспользован `DishPoolSection`), блок «Мастер-кабинет»
  (форма ФИО + email → `ConfirmDialog` с последствиями → «Приглашение отправлено на …» + ссылка + «Скопировать»;
  у существующего кабинета — сотрудники «Приглашён/Вошёл», «Новая ссылка», «Пригласить ещё», «Открыть мастер-кабинет»).
- Карточка «Мастер-кабинет справочников» в хабе `/settings` (группа «Журналы»; хаб открыт только admin.full), подпись в `route-titles.ts`.
- `/master` (`src/app/master/layout.tsx`, `page.tsx`, `src/components/master/master-shell.tsx`, `master-directory-client.tsx`):
  своя оболочка (название, «Мастер-кабинет справочников», бейдж кода с копированием, «Подключено объектов: N»,
  меню профиля: «Вернуться в «…»» для владельца + «Выйти»), серверная проверка kind=directory → иначе `/dashboard`.
  Вкладки «Меню → БЖГП» / «Сырьё → Скоропорт» / «Объекты» (`?tab=`), поиск, счётчик, таблица (у сырья — Поставщик/Изготовитель,
  на телефоне — строки-карточки), «Загрузить Excel/CSV», «Вставить списком» (поле заполнено текущим списком — удалил строку = убрал позицию),
  предпросмотр «Добавится N · Уберётся M · Без изменений K» + первые 20 новых/удаляемых, «Сохранить и разослать» → тост
  «Готово: список обновлён в N объектах (M журналов)»; пустое состояние с примерами формата; вкладка «Объекты» с инструкцией подключения.

## Правки A1, найденные на e2e (минимальные)
- `src/lib/master-directory-access.ts`: `/api/build-info` добавлен в белый список сессии кабинета — корневой layout
  (sw-register, build-version-watcher) опрашивает его на каждой странице, в `/master` это давало 403 в консоли и кабинет
  не узнавал о новой сборке. Тест `master-directory-access.test.ts` дополнен.
- `src/lib/master-cabinet.ts` + `/api/settings/master-cabinet`: в статус добавлено `master.viewerCanOpen`
  (членство смотрящего в кабинете) — чтобы показывать «Открыть мастер-кабинет» только тому, кто может переключиться.
- `DishPoolSection`: необязательные пропсы `onChange` (перечитать пул после привязки/отвязки) и `hideTitle`; поведение в БЖГП не меняется.

## Критерии приёмки
| AC | Статус | Доказательство |
|---|---|---|
| AC-A1 | PASS | e2e: руководитель X в `/settings/master-cabinet` ввёл ФИО/email → ConfirmDialog «Создать и пригласить» → кабинет `kind=directory` с `linkedServiceCode`=код X, на странице ссылка `/invite/<token>` и «Приглашение отправлено на …». Ссылка открыта в чистом браузере, пароль задан → попадание на `/master` с тем же кодом. Шоты `desktop-1440-settings-empty/confirm/created`, `mobile-390-settings`. |
| AC-A2 | PASS | e2e (сессия бэк-офиса в браузере): `/dashboard` и `/journals` → `/master`; `GET /api/staff` → 403, `GET /api/settings/master-cabinet` → 403. Обычная сессия: `/master` → `/dashboard`. Юнит-тест `evaluateDirectoryRequest` (A1 + дополнен). |
| AC-A3 | PASS | e2e: xlsx «Наименование / Борщ / Плов / Компот» через «Загрузить Excel/CSV» → предпросмотр «Добавится 3 · Уберётся 0 · Без изменений 0» → «Сохранить и разослать» → тост «Готово: список обновлён в 2 объектах (4 журнала)». В БД: itemsCatalog X = [Своё блюдо X, Борщ, Плов, Компот], Y = [Своё блюдо Y, Борщ, Плов, Компот]; `listNameSuggestions(Y,"dish")` (источник подсказок сайта и QR-формы) содержит все три. Шоты `desktop-1440-master-preview-xlsx`, `desktop-1440-master-menu-list`. |
| AC-A4 | PASS | e2e: «Вставить списком» на вкладке сырья «Молоко \| ИП Иванов \| Молокозавод / Кефир \| ИП Иванов / Творог» → предпросмотр +3 → сохранение. У X и Y productLists[0].items = своё + Молоко, Кефир, Творог; suppliers Y = [Свой поставщик Y, ИП Иванов]; manufacturers Y = [Молокозавод]. Шот `desktop-1440-master-raw-list`, `mobile-390-master-raw`. |
| AC-A5 | PASS | e2e: «Вставить списком» открыт с «Борщ\nПлов\nКомпот», оставлено «Борщ\nКомпот» → «Добавится 0 · Уберётся 1 · Без изменений 2» → PUT `{total:2, added:0, removed:1, organizations:2, documents:4}`; itemsCatalog Y = [Своё блюдо Y, Борщ, Компот], X = [Своё блюдо X, Борщ, Компот]. Шот `desktop-1440-master-preview-remove`. |
| AC-A6 | PASS | e2e: `prefillResponsiblesForNewDocument(Y, finished_product)` после правок → itemsCatalog [Борщ, Компот]. Позднее подключение к коду — A1 (`a1-integration.ts`: Z через HTTP `/api/settings/dish-pool` получил masterDocuments=2). |
| AC-A7 | PASS | A1: пул без мастера — подсказки/конфиг не меняются; `NOT_DIRECTORY_ORG_WHERE` в cron и подсчёте тарифа. В A2 бэкенд пула не менялся (DishPoolSection — только необязательные пропсы). |
| AC-A8 | PASS | `npm run typecheck` — 0 ошибок; `npm test` — 2109/2109; `npm run build` (NEXT_DIST_DIR=.next-master-cabinet) — exit 0, «Compiled successfully», маршруты `/master`, `/settings/master-cabinet`, `/api/master/*` в списке (`e2e/a2-build.log`). |

Мобильная ширина 390: на `/master` (три вкладки, предпросмотр) и `/settings/master-cabinet` `scrollWidth <= innerWidth` (проверка в e2e).
Скриншоты: `shots/*.png` (1440 и 390) — лежат локально, `.agent/**/*.png` в `.gitignore`.

## Замечания
- В dev-режиме на `/master` и на обычных страницах дашборда (`/settings`) React пишет hydration-mismatch у `ResponsiveMenu`/Radix id
  (мобильный вариант меню и id триггера). Это уже существующее поведение общего компонента (то же на шапке дашборда), не новое.
