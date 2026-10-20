# Evidence — pages-inspection-2026-10 («Пришла проверка»: блоки — пунктами меню)

Ветка `feat/pages-inspection` от `integ/sketch-wave` `76c01cc4`, рабочая копия `D:\wt\pages-inspection`,
база `wesetup_pages_inspection` (127.0.0.1:5432), dev-сервер `:3076` (`next dev --webpack`).
Демо «Столовая «Берёзка»»: руководитель `admin@haccp.local` (owner), заведующая `chef@haccp.local`
(technologist = head_chef), повар `hotcook1@haccp.local` (operator = cook) — пароль `admin1234` подошёл всем
(`check-passwords.cjs`), менять не пришлось.

Сырые артефакты — `raw/`: `results-{owner,phone,mini,headchef,cook}.json` и `playwright-*.txt` (Playwright),
`console-mini.json` (консоль Mini App), `tsc.txt` (пусто = 0 ошибок), `eslint.txt` (пусто = 0 замечаний),
`tests-nav.txt`, `i18n-check.txt`, скриншоты `*.png` (в git не попадают — `.gitignore: .agent/**/*.png`;
копия — `C:\Users\Two\wesetup-backup-2026-10-17\pages-shots\inspection\`). Скрипты: `pages-check.mjs`
(сценарии), `console-probe.mjs` (ошибки консоли), `chunk-probe.mjs` (синтаксис чанков), `summarize.mjs` (сводка), `db-query.cjs` / `check-passwords.cjs` (только своя база).
Лог dev-сервера (`raw/dev-server.log`, запросы Prisma) в коммит не входит.

## Что сделано

- **Меню раздела** (`src/lib/app-nav.ts`, `INSPECTION_MENU`): Что делать сейчас → Журнал посещений →
  Нормативка → QR для проверяющего → Готовность к проверке → Подготовка с экспертом и выезд → Спецрежим.
  Правила пунктов повторяют guard'ы страниц: новые страницы — `fullAccessOr("tasks.verify")`, эксперты —
  `FULL_ACCESS`. Иконки — уже существующие в `nav-icons.ts` (`ScrollText`, `BookOpen`, `Handshake`,
  `ShieldCheck`), файл не менялся.
- **«Что делать сейчас» `/inspection`**: заголовок «К вам пришла проверка (или придёт)», `PageGuide`
  («Как устроен раздел» + 2 вопроса), инструкция из 5 шагов (шаги 3 и 5 — «Открыть →» на свои пункты,
  2 и 4 — к блокам ниже), ② QR на экране (выпуск — как раньше, `canIssue = hasFullWorkspaceAccess`),
  ③ журнал посещений коротко (счётчик записей + «Открыть»), ④ архив ZIP, ⑤ спецрежим коротко (статус +
  «Открыть», `id="special-mode"` — ссылка из «Реквизитов» работает), «Ещё в разделе» — нормативка,
  готовность (балл, только `admin.full`), эксперты (руководство), «Кто смотрел» — как было.
- **`/inspection/visits`**: `InspectionVisitsCard` целиком (список, добавить запись со сканом, «Приложить
  скан», «Скрыть как ошибочную» / «Показать скрытые» / «Вернуть» — руководителю), шаги 1-2-3 «Как запись
  попадает в журнал», `PageGuide`, счётчик в шапке.
- **`/inspection/norms`**: `InspectionNormsCard` (новый флаг `bare` — без своего заголовка, он в шапке),
  ссылки — прямо на файлы `/api/production-control/...` (PDF скачивается, подписанный экземпляр — в новой
  вкладке), левое меню остаётся меню «Пришла проверка».
- **`/inspection/experts`**: шаги «Как заказать», карточки каталога «Аудит перед проверкой» и «Выезд
  специалиста» → `/settings/services?order=<ключ>`, пустое состояние, если услуги выключены в каталоге.
- **`/inspection/special-mode`**: карточка спецрежима (переключает только `admin.full`), «Когда включать»
  1-2-3, `PageGuide`; у остальных — «Включить или выключить может руководитель — попросите его.»
- Новые компоненты: `InspectionHowItWorks` (шаги 1-2-3), `InspectionSpecialModeStatus` (пилюля статуса).
- Тексты RU/EN/UZ (EN/UZ латиницей): `inspectionDay.now.*`, `inspectionDay.pages.*`, `guide.open`,
  подписи пунктов `navigation.shell.menus.inspection.items.*`, заголовки маршрутов `navigation.routes.inspection_*`
  (+ `route-titles.ts`, счётчик маршрутов в `navigation-localization.test.ts` 123 → 127); `message-contract.d.ts`
  перегенерирован (`node scripts/i18n-types.mjs`).
- Тесты: `app-nav.test.ts` (форма меню, пункты по ролям, владельцы путей), новый
  `src/components/inspection/inspection-pages.test.ts` (блоки не задвоены, якорь, права, нормативка без ППК,
  ссылки услуг).

## Итог по критериям

| AC | Вердикт | Доказательство |
|----|---------|----------------|
| AC1 | PASS | Guard прежний (`hasFullWorkspaceAccess(` или `"tasks.verify"`, тест «права страниц»). Playwright owner: заголовок «К вам пришла проверка (или придёт)», инструкция, шаги 3/5 — «Открыть →» на `/inspection/visits` и `/inspection/special-mode`, QR в `#qr`, «Скачать архив» в `#archive`, блоков-страниц целиком нет, кратко: счётчик посещений (`data-visit-count`), статус спецрежима, балл «5 из 16 в порядке», «Ещё в разделе» (нормативка, готовность, эксперты). `raw/results-owner.json`, `desktop-owner-now.png`, `mobile-owner-now.png`, `mini-owner-now.png`. |
| AC2 | PASS | Guard `hasFullWorkspaceAccess(` / `"tasks.verify"`. Playwright owner: пояснение «по QR … добавьте запись», шаги 1-2-3; запись со сканом PDF добавлена (201), скан открывается (200, PDF), «Приложить скан» → 2 файла, «Скрыть» (ConfirmDialog с причиной) → «Показать скрытые» → «Вернуть». Заведующая: «Добавить запись» есть, «Скрыть» нет. `raw/results-owner.json`, `raw/results-headchef.json`, `desktop-owner-visits*.png`. |
| AC3 | PASS | Guard `hasFullWorkspaceAccess(` / `"tasks.verify"`; заведующей открыта, PDF плана ХАССП — 200. Ссылки — `/api/production-control/{program,haccp-plan}/pdf` и `/documents/*/file` (`_blank`); «Открыть PDF» → скачивание «ППК — Столовая «Берёзка».pdf», URL остаётся `/inspection/norms`, левое меню — 7 пунктов «Пришла проверка» (не ППК); `sectionForPath("/inspection/norms")` ≠ productionControl (unit). `desktop-owner-norms.png`. |
| AC4 | PASS | Guard `hasFullWorkspaceAccess(` (как у карточки раньше), пункт `FULL_ACCESS`. Карточки «Аудит перед проверкой» и «Выезд специалиста» → `/settings/services?order=pre-inspection-audit|site-visit`, переход на заказ работает; шаги «Как заказать»; пустое состояние, если услуги выключены. Новые тексты без цен и рекламы (цены — из каталога, как было). `desktop-owner-experts.png`, `desktop-owner-services-order.png`. |
| AC5 | PASS | Guard `hasFullWorkspaceAccess(` / `"tasks.verify"`; руководитель включил и выключил (тост «Сохранено»), статус «Включён» виден на «Что делать сейчас»; у заведующей переключатель недоступен + «…попросите его». Пояснение: 3 эффекта + «Когда включать» 1-2-3. `/inspection#special-mode` прокручивает к блоку со статусом и «Открыть →»; ссылка в `organization-special-mode-card.tsx` не тронута (unit + Playwright). `raw/results-owner-tail.json`, `desktop-owner-special*.png`, `desktop-owner-now-special-*.png`, `desktop-headchef-special.png`. |
| AC6 | PASS | `menuShape("inspection")` = `[[null, ["now","visits","norms","portal","readiness","experts","special"]]]`; подписи RU/EN/UZ, иконки есть (тест иконок). Заведующая: now, visits, norms, portal, experts, special (без «Готовности», прямой заход → `/dashboard`); пресет заведующей на линейной роли — now, visits, norms, special; повар — раздела нет, все 5 адресов → редирект (1440 и 390). `raw/tests-nav.txt` (51/51), `raw/results-cook.json`, `raw/results-headchef.json`. |
| AC7 | PASS | tsc 0 ошибок (`raw/tsc.txt`), eslint 0 (`raw/eslint.txt`), `i18n:check` 82/82 (`raw/i18n-check.txt`), unit 51/51. Playwright (`raw/playwright-summary.json`): owner 42 + owner-tail 10, phone 11/11, mini 12/12, headchef 35 (+ повтор Mini App 12/12), cook 12/12 — каждый пункт открывает свою страницу под руководителем и заведующей, 1440 и 390, Mini App, добавление посещения со сканом. Падения в журналах прогонов — только сбои dev-сервера (решение 10), повторены. Предложение «Что нового» — ниже. |

Прогоны Playwright: `owner` — третий прогон (`results-owner.json` = `results-owner-run3.json`): 42 проверки до
спецрежима зелёные, затем недописанный чанк dev-сервера на `/inspection/special-mode`; спецрежим, «QR для
проверяющего» и «Готовность» повторены отдельной частью `owner-tail` — 10/10 (`results-owner-tail.json`).
Первый прогон owner (до правок скрипта) прошёл весь сценарий 45/46 (единственный ✗ — проверка статуса
спецрежима до загрузки пилюли; в скрипте добавлено ожидание); его вывод перезаписан повторами.
`headchef` — 35 ✓, 2 ✗ `pageerror: Invalid or unexpected token` в Mini App во время перекомпиляции; часть
`headchef-mini` повторена — 12/12. Консоль Mini App (`raw/console-mini.json`): ошибка гидрации атрибутов и
предупреждения `Telegram.WebApp … version 6.0` — те же на нетронутой `/settings/names`, к ветке не относятся
(это и есть «1 Issue» в оверлее Next).

## Решения по ходу

1. **Заведующая видит «QR для проверяющего» и «Подготовку с экспертом».** У демо-заведующей роль
   `technologist` (= head_chef) — управленческая, `hasFullWorkspaceAccess` = true; guard'ы этих страниц
   (`/settings/inspector-portal`, `/inspection/experts`) её пускают, как и раньше (QR она и выпускала —
   `canIssue = fullAccess`, карточку экспертов видела). Spec AC6.2 оговаривает «если их guard'ы не пускают».
   «Готовность» (`admin.full`) ей закрыта. Пользователь с пресетом заведующей на линейной роли видит
   только «Что делать сейчас», «Журнал посещений», «Нормативку», «Спецрежим» (unit-тест `verifyOnly`).
2. **Экспертов без права** `/inspection/experts` уводит на `/inspection` (оттуда повара — на `/journals`).
3. **Подпись карточки услуги** «Подготовка с экспертом» → «Аудит перед проверкой» (как в spec AC4), подсказка
   переписана без повтора; цены — из каталога, как и были. Новых цен/рекламы нет.
4. **Готовность на «Что делать сейчас»** — только балл «N из M в порядке» со ссылкой (AC1 «кратко»); список
   трёх главных замечаний остался на самой странице готовности. Ключи `fix`, `allChecks`, `allGood` в
   `inspectionDay` больше не используются — оставлены, чтобы не трогать чужие сценарии сведения.
5. **Нормативка** — ссылки и раньше вели прямо на файлы (`attachment` для PDF, `_blank` для подписанного);
   проверено, что URL и левое меню не меняются. Флаг `bare` убирает дублирующий заголовок «Нормативка».
6. **Иконки** — только существующие в `nav-icons.ts`, чтобы не конфликтовать с соседними ветками (`pages-staff`,
   `pages-company`, `pages-points` правят тот же список импортов).
7. **Заголовки маршрутов** добавлены как у соседей; строка счётчика `123 → 127` в
   `navigation-localization.test.ts` при сведении конфликтует с соседями — нужна сумма всех добавлений.
8. `organization-info-form.tsx` и `organization-special-mode-card.tsx` не тронуты; якорь `#special-mode` на
   «Что делать сейчас» сохранён (тест и Playwright).
9. **Диск D:** в начале работы `verify-worktree` нашёл 49 испорченных неизменённых файлов (в т.ч.
   `src/app/api/production-control/program/pdf/route.ts`) — восстановлены `--restore`, далее `corrupted: 0`.
10. **Dev-сервер под нагрузкой машины** (CPU ~80 %, ~140 процессов node других сессий): dev выгружает
    неактивные страницы и пересобирает их, а первый запрос к API-маршруту (например, PATCH спецрежима)
    пере-выпускает общие чанки. Переход в это время получает недописанный `app/layout.js`:
    `pageerror: Invalid or unexpected token` / `Loading chunk app/layout failed`, один раз 500
    `Unexpected end of JSON input`; клиентский переход по пункту меню однажды «потерялся» на 10 минут.
    Тот же чанк после сборки разбирается без ошибок (`chunk-probe.mjs`: 11 скриптов, 0 ошибок).
    В `pages-check.mjs`: повтор клика по пункту (`results.menuRetries`), ожидание «сборка улеглась» перед
    переходом после переключения спецрежима (`waitBuildSettled`), увеличенные таймауты. В продакшене
    чанки статические — к коду ветки не относится.
11. **Проверка PDF-скана под нагрузкой.** Однажды «Сохранить запись» вернула 400 «Не удалось прочитать
    файл…»: проверка PDF в worker'е (`pdf-isolated-check`, таймаут 5 с) не уложилась при перегруженном CPU;
    повторное нажатие сохранило запись (`results-owner.json`: `addVisitError`, `addVisitRetried`). Код
    проверки не менялся (вне задачи); если такое встретится на проде под нагрузкой — тема для отдельной
    задачи (таймаут 5 с).
12. Тестовые записи посещений — только в своей базе: две записи прерванных прогонов удалены (создавал их
    скрипт), остались записи «Проверкина Ольга Е2Е-…» последних прогонов. Спецрежим в своей базе выключен.

## Что ждёт людей

- Ничего обязательного. При сведении (S4) — сложить счётчик маршрутов в `navigation-localization.test.ts`
  и импорты `nav-icons.ts` соседей (эта ветка `nav-icons.ts` не меняет).

## Предложение для «Что нового» (руководителю)

«Пришла проверка» — по пунктам меню: журнал посещений, нормативка, спецрежим и подготовка с экспертом
открываются отдельно, а «Что делать сейчас» — короткая инструкция, где QR и архив документов под рукой.
