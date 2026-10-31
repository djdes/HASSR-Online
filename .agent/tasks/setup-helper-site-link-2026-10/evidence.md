# Evidence — setup-helper-site-link-2026-10

База: `origin/master` ddef6fb. Локально: Postgres 16 (`wesetup_dev`, `prisma db push`), `next dev` :3100,
демо-организация; фикстуры `raw/seed-helper-link.ts` (5 продуктов со сроками и условиями хранения, списки
блюд в действующем бракеражном журнале). Телефон — вход через `POST /api/setup-helper/auth` (как у
приложения), события — тем же JSON, что шлёт приложение (`raw/sync-body.json`).

## AC1 — справочник для приложения
`src/lib/setup-helper-catalog.ts` (чистая сборка), `.server.ts` (БД), `src/app/api/setup-helper/catalog/route.ts`.
Тесты `src/lib/setup-helper-catalog.test.ts` — 5/5: продукты справочника + списки скоропортящейся
продукции без дублей, срок в часах (`shelfLifeDays × 24`, мусор → null), блюда из `itemsCatalog` и
`productLists` бракеража, поставщики и сотрудники по алфавиту без повторов, лимиты, версия.
Живой ответ — `raw/catalog-response.json` (5 продуктов: «Котлеты куриные (п/ф)» 24 ч «+2…+6 °C», «Фарш
говяжий» 2160 ч «−18 °C и ниже»…, 5 блюд, 2 поставщика, 23 сотрудника). `raw/catalog-auth.txt`:
`?version=<та же>` → `{ version, unchanged: true }`; без ключа и с чужим ключом — 401 `device_revoked`.
`raw/catalog-isolation.txt`: продукт второй организации в справочник телефона первой не попадает;
отключённый на сайте телефон (`revokedAt`) получает 401 и на справочник, и на синхронизацию.
Документ бракеража в последний день периода (`dateTo` — полночь UTC) справочник не теряет — найдено и
исправлено при проверке.

## AC2 — событие `label_printed`
`src/lib/setup-helper.ts` (схема, `LabelRecord`, даты этикетки ±2 года, пустые поля отброшены, принтер —
как `printer_printed`), `src/app/api/setup-helper/sync/route.ts` (`recordLabelPrint`, P2002 → уже
записано), модель `LabelPrint` (`@@unique([organizationId, eventId])`). Тесты
`src/lib/setup-helper.test.ts` — 19/19, из них новые: этикетка как напечатана, даты далеко/мусор/без дат,
битая этикетка в `rejected` без падения пакета, последняя печать принтера. `raw/sync-idempotency.txt`:
один и тот же пакет из 8 событий дважды → оба раза 200 и `accepted` все, строк `LabelPrint` — 7.

## AC3 — журнал маркировки и сводка
`/settings/print-agent/labels` (`raw/labels-*-desktop.png`, `raw/labels-*-mobile.png`,
`raw/label-log-report.json`): 7 этикеток за 7 дней, 6 за сегодня, «только истекающие и истёкшие» — 4
(2 «Срок истёк», 2 «Истекает»), по сроку; у заморозки — только даты («Хранить до 29.01.2027»); подписи с
этикетки («Вскрыто», «Реализовать до», «Повар», «Отобрал»), поля, принтер и телефон; без горизонтальной
прокрутки на 390 px. Сводка на «Онлайн-принтере» (`raw/summary-*.png`): «6 этикеток · 9 копий», «Истекает
в ближайшие сутки 2», «Истёк срок за 7 дней 2», ссылка на журнал. Доступ — `hasFullWorkspaceAccess`, как у
страницы «Онлайн-принтер»; даты — в часовом поясе организации. `src/lib/label-prints.test.ts` — 3/3.
Попутно: на странице журнала и на табличке для зала (PR #68) убрана своя ссылка «назад» — её уже даёт
общий `PageNav` (`raw/badge-sign-toolbar.png`: одна «‹ Реквизиты»).

## AC4 — приложение
Ядро: `Catalog` (разбор, `names(source)`, поиск продукта без учёта регистра), `TemplateField.source/fillFrom`,
`RecordSpec`, `LabelRecord` (та же дата, что на этикетке; «только дата» — до конца дня; лимиты сайта),
разбор и проверки в `TemplateParser`; 10 шаблонов маркировки получили `source`, `fillFrom` и `record`.
Приложение: `ApiClient.fetchCatalog`, `CatalogStore` (копия файлом, сеть вне блокировки, стирается при
выходе), `HelperApp.refreshSiteData` (шапка + справочник), подсказки и `applyProduct` на экране печати,
`HelperEvents.labelPrinted`, очередь до 1000 событий. `raw/android-tests.txt`: `:core:test` 55/0
(новые `CatalogTest` 4, `LabelRecordTest` 4, `TemplateParserTest` +2), `:app:testSiteDebugUnitTest` 48/0
(новые `HelperEventsTest` 2, `ScreensTest` +1 — подсказки из справочника, подстановка срока 36 ч и
«0…+4 °C», подпись «из справочника»), `PlayFlavorTest` 2/0.

## AC5 — версии и проверки
Приложение 1.4.0 (versionCode 7), `app/release-notes.txt`, README (справочники, `record`, `label_printed`).
Сайт: `npm run typecheck` — exit 0; `npx eslint` по 13 изменённым файлам — чисто; `npm run i18n:check` —
97/0; `npm run test:gate` — см. `verification.md`.

## AC6 — выпуск
Подписанный APK собирает только CI (ключ выпуска — в секретах GitHub, в репозиторий не кладётся). После
слияния: «Сетап помощник — проверка» → Run workflow на master с `publish`, артефакт
`setup-helper-publish-N` → `resources/setup-helper/` отдельным PR. Статус — в `verification.md`.

## Изменения при деплое
Новая таблица `LabelPrint` (связи с `Organization` и `SetupHelperDevice`) — `prisma db push` создаст её
без потери данных. Новый маршрут `GET /api/setup-helper/catalog`.
