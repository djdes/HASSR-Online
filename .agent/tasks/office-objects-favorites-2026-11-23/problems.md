# Problems: office-objects-favorites-2026-11-23

Вторая свежая проверка, 2026-11-24, `2cc6b7b0b` (master `043c5b7bb` влит). Стенд — только локальный (PostgreSQL на localhost,
`next dev` :3000). Вердикт — `verdict.json`: **FAIL**, открыты AC4 и AC5. Сценарии и выводы — в
`/tmp/claude-0/-home-user-HASSR-Online/9db99cea-0bbc-5d62-bbca-aabb50b143e4/scratchpad/verifier2/`.

## Закрыто с прошлой проверки (`c88a30e8f`)

- AC8 — «Все объекты» в ru/en/uz, как в окне правки, пилюля нейтральная — `f778c8aa4`.
- AC4 — окно жалоб пишет «Выберите объект…», плашка у всех журналов со списком документов, окна протокола аудита,
  металлопримесей и списка стекла разбирают ответ через `readCreatedDocument` — `f778c8aa4`.
- AC5 — переход периода по QR и приёмка по ВСД больше не заводят документы на офис — `f778c8aa4`; перенос на обычной
  выкладке (подсчёт, затем перенос), дубли и журналы, выключенные на объекте, остаются на офисе (решение владельца) —
  `2cc6b7b0b`.

## AC5 — FAIL

**Текст.** Журналы офиса — на объекты; на офис больше не создаются. Разовый скрипт
`prisma/seed-office-journals-to-points-2026-11.ts` (`--dry-run`, ключ `once:office-journals-to-points:v1`) переводит
`JournalDocument` и `PaperJournalDocument` с офиса на единственный объект, при нескольких — на первый (`sortOrder`,
название); без объектов — не трогает; пишет журнал действий; подключён в деплое с `|| warn`. `buildingTargets` при делении
по объектам не возвращает офис (автосоздание и раздача — только объекты). Решение владельца 2026-11-24: на обычной выкладке
сначала `--dry-run`, затем перенос; дубли и выключенные на объекте журналы остаются на офисе.

**Почему не доказано.** Перенос, выкладка и переход периода по QR проверены и в порядке (см. `verdict.json`). Не выполнено
«на офис больше не создаются»: два пути по-прежнему заводят **новый** документ журнала на офис.

1. Внешний API строк (`POST /api/external/entries` → `dispatchExternalEntries`). Цели — `buildingTargets`
   (`src/lib/external/dispatch.ts:782`), офис среди них. `resolveExternalEntryPoint` (`src/lib/external/entry-point.ts`)
   выбирает офис, если все сотрудники строк работают в офисе (`workBuildingsForUser` → [офис]) или в запросе
   `buildingId` офиса. `findOrCreateDocument` (`dispatch.ts:280`) создаёт документ с `buildingId` офиса.
2. Приёмка накладной ЭДО (`POST /api/edo/documents/[id]/accept`). Точки приёмки — все здания из контекста, офис тоже
   (`src/lib/supply/supply-points.ts:135`). Окно приёмки получает этот список (`src/app/(dashboard)/edo/[id]/page.tsx:108`),
   сервер проверяет выбор по нему же (`accept/route.ts:75`). `acceptSupplyDocument` → `ensureActiveDocument(buildingId: офис)`
   (`src/lib/supply/documents.server.ts:217-222`) — документ журнала приёмки на офисе. Накладная может попасть на офис и
   сама: `supplyPointByKpp` берёт `buildingTargets` (`documents.server.ts:88`), и тогда офис в окне выбран заранее
   (`edo/[id]/page.tsx:50`). Так же привязываются склады iiko (`src/app/api/settings/supply/[provider]/stores/route.ts:92`,
   `src/lib/supply/sync.server.ts:122,139`).

Перенос разовый (ключ `once:…:v1`): такие документы на объект уже не перейдут. На странице журнала с объектом в шапке их не
видно, задачи их не охватывают.

**Минимальное воспроизведение.** `npx tsx --tsconfig tsconfig.json <scratch>/verifier2/repro-ac5.ts creation` (в подоболочке
с `.env`, только локальная БД). Сценарий создаёт временную организацию: офис и 2 объекта, журналы по объектам, сотрудник
офиса и владелец. Потом удаляет её (leftover 0).
- `dispatchExternalEntries({ journalCode: "health_check", entries: [{ employeeId: <сотрудник офиса> }] })`;
- `dispatchExternalEntries({ journalCode: "climate_control", buildingId: <офис>, entries: [...] })`;
- `supplyPointAccessFrom(resolveActiveBuilding(<владелец, «Выберите объект»>))`, затем
  `acceptSupplyDocument({ buildingId: <офис>, ... })` по новой накладной.

**Ожидалось / получено.** Ожидалось: документ только на объекте или отказ «выберите объект». Получено: `health_check` на
ОФИСЕ (ok), `climate_control` на ОФИСЕ (ok), точки приёмки `[ОФИС, p1, p2]`, приёмка принята, `incoming_control` на ОФИСЕ.

**Затронутые файлы.** `src/lib/external/dispatch.ts`, `src/lib/supply/supply-points.ts`, `src/lib/supply/documents.server.ts`,
`src/app/api/edo/documents/[id]/accept/route.ts`, `src/app/(dashboard)/edo/[id]/page.tsx`; по желанию — сопоставление
складов iiko (`stores/route.ts`, `sync.server.ts`); тест-страж `src/lib/office-journals.test.ts:77-96`.

**Наименьшее безопасное исправление.**
- `dispatch.ts:782`: `documentBuildingTargets(organizationId)` вместо `buildingTargets`. Явный `buildingId` офиса → 400
  «не найден среди точек». Строки сотрудника офиса попадут на единственный объект или вызовут «укажите buildingId», как
  у сотрудников без закрепления.
- ЭДО: в `supplyPointAccessFrom` список выбора точки приёмки (`points`, по нему же проверяет `resolveAcceptancePoint`)
  отдавать без офиса (`!isOfficeBuilding`). Видимость (`seeWhere`/`canSee`) оставить по всем зданиям, иначе пропадут
  накладные, уже привязанные к офису. `supplyPointByKpp` перевести на `documentBuildingTargets`.
- Тесты: `dispatch.ts` и `supply/documents.server.ts` добавить в список файлов-стражей «не видят офис». Юнит-тест
  `supplyPointAccessFrom`/`resolveAcceptancePoint`: офис не предлагается и не принимается.

**Подсказка исправляющему.** Это тот же класс, что приёмка по ВСД, исправленная в `f778c8aa4`: точку документа берут из
`buildingTargets` или из всех зданий контекста. Хватит убрать офис из выбора точки в этих двух местах и закрепить это
тестом-стражем.

## AC4 — FAIL

**Текст (проверяемая часть).** … Окна со своим разбором ответа (`readCreatedDocument`) на `point_required` пишут «Выберите
объект…», а не «Не удалось создать документ». Решение в спеке: «сервер без объекта отвечает понятной ошибкой, которую
показывают и остальные окна создания».

**Почему не доказано.** Плашка, API, общее окно и четыре исправленных окна в порядке. На стенде проверены жалобы (тост),
протокол аудита (строка в окне), `daily_samples` и отчёт аудита (плашка). Но класс, отмеченный в прошлом вердикте (окна
разбирают ответ сами, без `readCreatedDocument`), закрыт не полностью.
1. «Отчёт о внутреннем аудите» (`audit_report`). `createDocument` сам разбирает ответ и бросает текст сервера
   (`src/components/journals/audit-report-documents-client.tsx:242`). Кнопка окна обёрнута в `try … finally` без `catch`
   (`:167`). При `point_required` окно молчит: нет ни строки ошибки, ни тоста, исключение на странице не обработано.
2. «Прослеживаемость» (`traceability_test`). `persistDocument` бросает обычную ошибку
   (`src/components/journals/traceability-documents-client.tsx:386`). `useDocumentDialogSubmit` показывает общий текст
   «Не удалось создать документ».
3. Того же вида кнопка «Создать» у скан-журналов (`src/components/journals/scan-journal-documents-client.tsx:78-107`): нет
   `catch`, текст общий. На стенде скан-журналов нет, в UI не проверено.

**Минимальное воспроизведение.** Стенд, владелец (`owner@stand.local`). Открыть `/settings/organization` (в шапке станет
«Выберите объект»). Очистить `localStorage['wesetup.point-return']`. Открыть `/journals/audit_report` → «Создать документ»
→ «Создать». Сценарий: `node <scratch>/verifier2/probe-audit-report.cjs`.

**Ожидалось / получено.** Ожидалось: «Выберите объект: документ журнала создаётся для объекта». Получено: `POST
/api/journal-documents` → 400 `point_required`, окно открыто без сообщения, тостов нет, `pageerror: Error: Выберите объект…`
(скриншот `<scratch>/verifier2/probe-audit-report.png`). У прослеживаемости, по коду, — «Не удалось создать документ».

**Затронутые файлы.** `src/components/journals/audit-report-documents-client.tsx`,
`src/components/journals/traceability-documents-client.tsx`, `src/components/journals/scan-journal-documents-client.tsx`,
`src/components/journals/read-created-document.test.ts`.

**Наименьшее безопасное исправление.** Сделать как в `f778c8aa4` для протокола аудита.
- Создание через `readCreatedDocument(response, …)`: в `createDocument` отчёта аудита и в POST-ветке `persistDocument`
  прослеживаемости. PATCH-ветку не трогать.
- Кнопку окна отчёта аудита перевести на `useDocumentDialogSubmit` + `DocumentDialogFeedback`.
- В `handleCreate` скан-журналов добавить `catch` с тостом `journalControls.documentDialog.pointRequired` для
  `PointRequiredError`, иначе `createError`.
- Закрепить тестом. Регулярное выражение в `read-created-document.test.ts` не находит вызов с условным адресом у
  прослеживаемости, поэтому для неё нужна своя проверка.

**Подсказка исправляющему.** Найдите все `POST /api/journal-documents` в `src/components/journals` без
`readCreatedDocument`. Окна создания среди них: отчёт аудита, прослеживаемость, скан-журналы. Входной контроль показывает
текст сервера и подходит. Переведите их создание на общий разбор ответа, и окно само напишет «Выберите объект…».

## Не блокирует

- Перенос идёт в шаге 3/3 до переключения на новую сборку. Несколько секунд старая сборка ещё отвечает и может завести
  документ на офис (окно создания, QR, крон). Разовый перенос его уже не заберёт.
- Пока проходила проверка, `origin/master` сдвинулся на `60b20ea07` (#322, только файлы seo-links, с веткой не
  пересекается). Перед слиянием снова влить master и прогнать проверки: сгенерированные CSS могут потребовать пересборки.
