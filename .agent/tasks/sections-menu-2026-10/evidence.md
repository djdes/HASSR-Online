# Evidence: sections-menu-2026-10 (каркас меню разделов кабинета)

Проверено 2026-10-17/18 на текущем коде ветки `feat/sections-menu` (база `b91388b0`), демо-база `wesetup_showcase`, сервер `http://localhost:3053` (сборка `.next-sm` 20:44 — позже всех правок `src/`, см. decisions.md п. 17).

Итог: **все AC — PASS.**

| AC | Вердикт | Доказательство |
|----|---------|----------------|
| AC1 | PASS | `menuShape` в `app-nav.test.ts` сверяет меню 7 разделов пункт в пункт; «правило каждой вкладки и карточки повторяет guard страницы» проходит по пунктам и вкладкам пунктов (у каждого есть `page.tsx` и токен guard'а). `raw/tests-nav.txt`: 45/45. |
| AC2 | PASS | Тест «каждая страница кабинета принадлежит разделу» и «все 51 карточка бывшего хаба на месте» — зелёные. Снимок навигации по ролям до (HEAD `b91388b0`) и после — пересоздан заново, совпал с сохранённым; `role-diff.mjs` → exit 0: у руководителя, управляющей, заведующей, «линейного с пресетом заведующей», «разрешения менять настройки» и повара не пропало ни одного адреса; ушли только хабы-редиректы `/settings/sections/{staff,points}` (их карточки — пункты меню). `raw/role-diff.txt`. |
| AC3 | PASS | `navigation.shell.menus.{company,staff,points,journals,checklists,productionControl,billing,inspection}` — 75 подписей на RU/EN/UZ, ключи совпадают, в EN/UZ кириллицы нет; `shell.items/menuGroups/subtabs` нет (и тест это проверяет). `npm run i18n:check` — 82/82 (после `node scripts/i18n-types.mjs`, лечит CRLF). |
| AC4 | PASS | Тест «match пункта…»: `/settings/journal-periods` → `setup` («Настройка журналов»), `/settings/users/x/access` → `users`, `/settings/role-presets` → `access` + вкладка `/settings/role-presets`, `/production-control/haccp/team` → ППК/`team`. |
| AC5 | PASS | `menu-check.mjs` (1440×900): руководитель — 9 разделов в главном меню; вход в каждый раздел с меню → `data-sidebar-mode=section`, логотип/монограмма, «‹ Главное меню», заголовок раздела, пункты; **51/51** пунктов открывают свою страницу (HTTP < 400, без увода, пункт `aria-current=page`, меню раздела на месте); заведующая — 41/41; «Остальное» → `mode=main`. `raw/results-owner.json`, `raw/results-headchef.json`, `raw/desktop-*.png`. |
| AC6 | PASS | Телефон 390×800: лист бургера в каждом разделе с меню — `mode=section`, логотип, пункты, «‹ Главное меню» → 9 (руководитель) / 8 (заведующая) разделов. Mini App (`ws-shell=mini`): кнопка меню раздела во всех разделах с меню, лист с логотипом, тем же меню и «‹ Главное меню» → тот же список разделов; в «Остальном» кнопки нет. `raw/mobile-*.png`, `raw/mini-*.png`. |
| AC7 | PASS | Руководитель: тест «руководитель видит все пункты меню каждого раздела» + браузер (все пункты, 4 вкладки «Доступа и прав»). Заведующая: нет «Моей компании», «Ответственных», «Нагрузки», «Готовности к проверке»; во «Доступе и правах» нет вкладки «Наборы прав» (HTML `/settings/journal-access`: вкладки journals/permissions/positions, у руководителя ещё presets); без «Добавить логотип». Повар: `sidebar=false`, бургера и кнопки меню раздела нет (сайт и Mini App), `raw/results-cook.json`. |
| AC8 | PASS | `main h1` в браузере: `/settings/sections/journals` → «Настройка журналов», `/settings/staff-health` → «Медкнижки и обучение», `/inspection` → «К вам пришла проверка (или придёт)» (у руководителя и заведующей). |
| AC9 | PASS | `npx tsc --noEmit --skipLibCheck -p tsconfig.typecheck.json` — без ошибок. `eslint` по 34 изменённым `.ts/.tsx` — 0 ошибок, 1 старое предупреждение (`Date.now()` в `more/page.tsx`, строки нет в диффе). Тесты `app-nav`, `settings-cards`, `navigation-localization`, `no-settings-hub-links`, `components/layout/navigation-localization` — 45/45; i18n — 82/82. Полный прогон тестов — pre-commit hook (`test:gate`). |
| AC10 | PASS | 94 скриншота в `raw/` (PNG в `.agent/**` игнорируются git — лежат на диске, копия в `C:\Users\Two\wesetup-backup-2026-10-17\sections-menu\screenshots-2026-10-18\`): `desktop-<роль>-<раздел>.png` и `desktop-<роль>-main-menu.png` (1440×900); `mobile-<роль>-<раздел>.png` (лист меню), `mobile-<роль>-<раздел>-page.png` (страница), `mini-…` то же для Mini App (390×800); повар — `*-cook-home.png`. |
| AC11 | PASS | `src/lib/whats-new-notes.ts`: первая категория «Интерфейс» (иконка `Settings2` есть в `CATEGORY_ICONS`), 6 пунктов — своё меню у раздела, логотип над меню, настройки стали пунктами, «Доступ и права», принтер, крупные заголовки. |

## Команды и артефакты
- `raw/tests-nav.txt` — 5 тестовых файлов, 45 pass.
- `raw/role-before.json`, `raw/role-after.json`, `raw/role-diff.{json,txt}` — снимки навигации ролей (`role-snapshot.ts`, «до» — из `git show HEAD:` в временную копию модулей) и сравнение (`role-diff.mjs`).
- `raw/results-{owner,headchef,cook}.json` — `menu-check.mjs` по ролям (`ROLES=<роль>`), `problems: []` у всех.
- Скриншоты — см. AC10.

## Что нашлось по ходу проверки (не от этой ветки)
1. **«Реквизиты» падали на демо-базе** (`okvedsExtra.length` у `undefined`): у демо-организации в `legalProfileJson` неполный профиль, `readLegalProfile` его пропускает. Починены данные демо-базы, код формы не трогал (decisions.md п. 15). В бою профиль полный (пишет `buildLegalProfile`), но нормализацию в `readLegalProfile` стоит добавить при работе над «Моей компанией».
2. **Ограничитель переходов** (`page-navigation-limit.ts`, 6 страниц / 10 с для headless) отвечал 429 на быстрый обход — `menu-check.mjs` теперь ходит не чаще раза в 2,6 с и ждёт `Retry-After`; ограничитель не обходится.
3. **Демо-заведующая не приняла новую оферту** — модалка «Мы обновили условия» закрывала экран; скрипт принимает её как человек (галочка + «Принять и продолжить»), запись — в локальной демо-базе.
4. На странице «Сотрудники» ряд кнопок шапки (`Шаблон … Инструкция`) на 1440 уходит за правый край — страница этой веткой не менялась, ширина сайдбара та же, что до ветки.
5. «Сегодня» (`/dashboard`) не имеет `h1` в `main` (заголовок «Обязательные журналы» — h2) — было и до ветки, в AC8 не входит.
