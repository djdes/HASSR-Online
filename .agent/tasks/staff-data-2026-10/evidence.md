# Evidence — staff-data-2026-10 («Сотрудники»: данные и логика раздела)

Ветка `feat/staff-data`, worktree `D:/wt/staff-data`, база `wesetup_staff` (localhost:5432),
dev-сервер `http://localhost:3044` (webpack). Проверено 2026-10-18.

Артефакты: скриншоты и ответы API — `raw/`; сквозные прогоны — `e2e/staff-e2e.ts`
(→ `e2e/staff-e2e.json`, **52/52 PASS**) и `e2e/ac4-perishable-commission.ts`
(→ `e2e/ac4-perishable-commission.json`, **21/21 PASS**). Оба скрипта возвращают базу как
было (должности, пресеты, почта, иерархия, токены, документ скоропорта, состав, PIN).
Скриншоты `raw/*.png` под `.gitignore` (`.agent/**/*.png`) — лежат в worktree локально,
в коммит попали JSON-ответы API и результаты прогонов.

## Итог по критериям

| AC | Статус | Доказательство |
|---|---|---|
| AC1.1 | PASS | `JobPosition.plannedHeadcount Int?` в `prisma/schema.prisma`; колонка есть в `wesetup_staff` (проверено `information_schema.columns`), Prisma Client сгенерирован |
| AC1.2 | PASS | `src/lib/staffing.ts` (занято = активные не в архиве, план, вакансии, перебор, «занято N из M», итоги) — `src/lib/staffing.test.ts` 6/6 |
| AC1.3 | PASS | e2e: «занято 1 из 2» + вакансия, перебор при плане 0, «занято N» без плана, `totals` — `raw/ac1-positions-api.json` |
| AC1.4 | PASS | e2e: POST/PATCH принимают 0…999 и `null`; 1000, `"3"`, 1.5 → 400 |
| AC1.5 | PASS | e2e: `PUT /api/positions/order` сохраняет порядок; чужой/неизвестный id → 404, повтор и пустой список → 400, повар → 403 |
| AC1.6 | PASS | e2e + `raw/ac1-ac6-staff-page.png`, `raw/ac1-edit-position-dialog.png`, `raw/ac1-ac6-staff-page-mobile.png`: поле «Штатная численность» в окнах создания и правки (сохраняется), пилюля «занято N из M» (зелёная/янтарная/розовая), 390 px без горизонтального скролла |
| AC2.1 | PASS | e2e: `GET /api/users/[id]/access` → `permissionPreset: null`, `effectivePreset: "head_chef"` (+ `defaultPreset`, `presets[]` с возможностями организации, `canChangePreset`, `isSelf`) |
| AC2.2 | PASS | e2e + `raw/ac2-access-dialog-preset.png`: блок «Набор прав» — «По должности (автоматически)» и все пресеты с описанием и списком возможностей; `POST /api/staff/[id]/preset` уходит один раз при изменении и не уходит без изменения |
| AC2.3 | PASS | e2e: себе «Контроль-группа» → 400 `SELF_LOCKOUT`; в окне на себе вариант заблокирован (`raw/ac2-access-dialog-self-locked.png`); тесты `decidePresetChange` и проверка `invalidateJournalAcl(id)` в маршруте |
| AC2.4 | PASS | тексты `staffManagement.access.*` в ru/en/uz; `node scripts/i18n-types.mjs --check` — свежо; тест «подписи ru/en/uz для каждого пресета и возможности»; полный набор тестов в pre-commit — 0 падений |
| AC3.1 | PASS | `control_group` в `permission-presets.ts` (журналы, сотрудники, отчёты, статистика, `tasks.verify`, новая `tasks.assign`; без `journals.manage`/`mini.tasks`); `tasks.assign` у `admin`; `ALL_PRESETS`/`ALL_CAPABILITIES`/`CAPABILITY_LABELS` читают `/api/settings/role-presets` и `/settings/role-presets` (тест сверяет тексты файлов) |
| AC3.2 | PASS | `decideJournalAcl`: чтение всех журналов, запись/закрытие — нет даже руководителем (тест); e2e: контроль-группа с ролью руководителя → 403 на взятие задачи (canWriteJournal) и закрытие документа, `/journals` открывается (`raw/ac3-control-group-journals.png`) |
| AC3.3 | PASS | `decideTaskAssignment` — тесты по должностям/людям/«никого»/журналам; e2e: свой сотрудник и журнал → 200, чужой сотрудник → 403 `TARGET_OUT_OF_SCOPE`, чужой журнал → 403 `JOURNAL_OUT_OF_SCOPE`, участнику контроль-группы → 409 `TARGET_CONTROL_GROUP` |
| AC3.4 | PASS | e2e: контроль-группа `POST` и `DELETE /api/manager-scope` → 403; тест проверяет оба guard'а и что GET их не имеет |
| AC3.5 | PASS | e2e: `GET /api/staff/control-group` → участники с `scope.sees` («Видит должности: Повар горячего цеха») и `scope.assigns`, кандидаты без себя — `raw/ac3-control-group-api.json` |
| AC3.6 | PASS | `src/lib/control-group-access.test.ts` 20/20: возможности, ACL, назначение по `ManagerScope`, смена пресета, описание иерархии, меню контроль-группы с ролью руководителя и с линейной ролью |
| AC4.1 | PASS | e2e: окно «Комиссия» сохранило состав организации и скопировало его в активный документ с `commissionEnabled` (`raw/ac4-02-commission-dialog.png`); `withOrgCommission` — новый документ; `ensureCommissionPosition` — доступ к обоим бракеражам |
| AC4.2 | PASS | e2e: старая копия без метки — «Комиссия» без счётчика, статусов нет (`raw/ac4-01-legacy-copy-inactive.png`); сохранение с сайта не снимает метку и состав; тесты `isCommissionActive`/`effectiveCommissionMembers`/`commissionConfigView`, row-merge |
| AC4.3 | PASS | e2e + `raw/ac4-03…04, 08…10`: «Комиссия · 1», строка состава, «Сегодня: 2 записи, 2 ждут подписи комиссии», статусы записей, сервер 409 `unsigned-rows`, окно закрытия объясняет причину, «Подписать» для члена комиссии (метод session), после подписей закрывается |
| AC4.4 | PASS | e2e + `raw/ac4-05…07`: член комиссии на QR сначала вводит PIN, видит 2 позиции за сегодня, «Подписать · 1» → «Подписано: 1», подпись (метод qr) и `SignatureEvent` в документе, «Подписано: Лебедева М. О. · ЧЧ:ММ» |
| AC4.5 | PASS | обновлены `brakerage-commission.test.ts` (perishable в журналах с комиссией, метка, незакрытые строки с/без метки), `brakerage-row-merge.test.ts`, `perishable-rejection-document.test.ts`, `brakerage-qr-post.test.ts`; новый `perishable-commission-ui.test.ts` |
| AC5.1 | PASS | `src/lib/inspectors-auditors.ts` + `inspectors-auditors.test.ts` 4/4 (внешние: вид/статус/кто выпустил/визиты; внутренние: проверяющий журнала, документа, помещения, аудитор `audit_*`, аудитор прослеживаемости); e2e: QR портала (`kind: "qr"`, `status: "active"`, `issuedBy`) и внутренние роли |
| AC5.2 | PASS | e2e: `GET /api/staff/inspectors-auditors` → 200, в ответе нет `tokenHash` (`raw/ac5-inspectors-auditors-api.json`); повар → 403 |
| AC6.1 | PASS | e2e + `raw/ac6-edit-employee-email.png`: телефон («+7 985 123-45-67») и почта в строке, поле «Почта» в окне правки сохраняется через `PUT /api/users/[id]` (200), неверный формат → 400 |
| AC7.1 | PASS | `npx tsc --noEmit --skipLibCheck -p tsconfig.typecheck.json` — exit 0 (и в pre-commit каждого коммита) |
| AC7.2 | PASS | `eslint` по изменённым файлам — 0 ошибок (остались прежние предупреждения в `staff-dialogs.tsx`, `document-pdf.ts`, `journal-responsibles-client.tsx`) |
| AC7.3 | PASS | новые и затронутые тесты зелёные; полный прогон pre-commit (`test:gate`) — pass=4100, fail=0 (коммит 1) |
| AC7.4 | PASS | Playwright на своей базе: 52/52 и 21/21, скриншоты в `raw/` |
| AC7.5 | PASS | коммиты в `feat/staff-data` на русском, без пуша |

## Проверки (команды)

- `npx tsc --noEmit --skipLibCheck -p tsconfig.typecheck.json` → exit 0.
- `node --import tsx --test src/lib/staffing.test.ts src/lib/control-group-access.test.ts src/lib/inspectors-auditors.test.ts src/lib/checklist-access-api.test.ts src/lib/app-nav.test.ts src/lib/role-access.test.ts src/lib/permissions-manager.test.ts src/lib/navigation-localization.test.ts src/lib/staff-access-presets.test.ts src/i18n/*.test.ts src/components/staff/*.test.ts` → все зелёные.
- Тесты бракеража: `brakerage-*.test.ts`, `perishable-rejection-*.test.ts`, `perishable-commission-ui.test.ts`, `finished-product-*.test.ts` → зелёные.
- `node scripts/i18n-types.mjs --check` → свежо.
- pre-commit (`check-secrets`, полный tsc, `test:gate`) — пройден на обоих коммитах.
- `verify-worktree.cjs` → corrupted 0; `scan-corrupt.cjs` → corruptModifiedByAgent 0, corruptUntracked 0.

## Решения по ходу

1. **Занято** — активные (`isActive`) и не в архиве. Итоги: `planned`/`occupiedPlanned` — только по должностям с планом, `occupied` — по всем.
2. **Порядок должностей**: присланные id — `sortOrder` 1…N, остальные должности организации — следом в прежнем порядке. Чужой и неизвестный id одинаково → 404.
3. **Контроль-группа без строки «Иерархии»** видит всех — как `filterSubordinates` везде в кабинете. Сузить — руководитель в «Иерархии».
4. **Контроль-группа с линейной ролью** не откроет `/reports` и `/dashboard`: их режет `proxy.ts` по роли (proxy/app-nav не менялись). Видимость меню зафиксирована тестом: руководитель — всё рабочее без «Моей компании»; линейная роль — «Сотрудники → Команда», «Журналы → Сегодня (панель контроля) / Все / Проверка», «Пришла проверка → День проверки».
5. **Запрет записи** контроль-группе — в `journal-acl.ts` и дополнительно в `PATCH`/`DELETE /api/journal-documents/[id]`, где руководство обходило ACL. Пресет берётся из сессии, иначе из базы (тот же кэш).
6. **Самоблокировка**: себе нельзя поставить набор без `admin.full` (с учётом org-override), а не только «снять admin».
7. **`/api/settings/role-presets`**: в zod 4 `z.record` с enum-ключами требует все ключи — частичное сохранение давало 400. Заменено на `z.partialRecord`.
8. **Почта**: проверка zod `email()`, пустая строка/null — стереть, регистр не меняется (как в `/api/staff/[id]/credentials`).
9. **AC4 (комиссия скоропорта)** делал параллельный агент-форк по моим указаниям; код, тесты и e2e проверены мной; в e2e AC4 исправлена уборка (удалялись все `SignatureEvent` документа и не возвращались другие активные документы) и ожидания ответов.
10. **Dev-сервер**: нативный SWC под next-intl отказывается работать, если в цепочке папок кэша другой пользователь может заменить файлы (`C:\Users\Two` даёт F пользователю BSQL\Yaroslav, `D:\` — Everyone). Создана своя папка `C:\swc-cache-two` (права только Two/SYSTEM/Administrators), запуск: `SWC_NATIVE_BINDING_CACHE=C:\swc-cache-two npx next dev --webpack -p 3044`. Системные права не менялись. Пароль `Staff2026!` выставлен шести демо-пользователям локальной базы для входа Playwright.

## Не сделано / ограничения

- Страницы «Должности», «Доступ и права», «Группы и комиссии», «Проверяющие и аудиторы» — по spec строятся позже на `feat/sections-menu`; API готовы.
- Тексты ответов API (ошибки) — по-русски, как в остальных маршрутах раздела; окно доступа показывает свои локализованные сообщения.
