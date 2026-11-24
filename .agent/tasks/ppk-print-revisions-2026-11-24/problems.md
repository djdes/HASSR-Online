# Problems: ppk-print-revisions-2026-11-24 (verifier, 2026-11-24)

Verdict: **FAIL**. AC5 fails (major) and AC2 fails (minor). AC1, AC3, AC4, AC6–AC9 and the local part of AC10 pass.
Judged revision: HEAD 6d58f5a98 (code from 8f9264e7d). Full detail is in `verdict.json`.

## Must fix

1. **V1 (major, AC5 / Р7 «без падения»).** `src/lib/ppk/structure-pdf.ts:74-88` (`docxText`), called at `:113-115`. Text extraction from a DOCX has no decompression bound. The repo already has a guard for this, `officeZipWithinLimits()` (`src/lib/knowledge-documents.ts:31`, used by the preview route), but this code does not call it, and uploads do not check it either. Measured: a 61 KB DOCX inflates to 60 MB of XML and adds 254 MB of RSS. A crafted DOCX placed in procedures, the knowledge base, a scan folder, or sent through PUT replace can exhaust the heap of the shared server on every PPK PDF build. That build runs from the program PDF, the inspector link, the employee's file and the compliance bundle.
   Fix: return `null` (plan `skip`) when `!officeZipWithinLimits(bytes)` before `JSZip.loadAsync`.

2. **V2 (minor, AC2).** `src/components/production-control/revision-control.tsx:145`. AC2 requires the plaque to show «код, дата, кто утвердил». The compact plaque (app 5, app 6, `/knowledge`) never shows who approved.
   Fix: render `approvedBy` in compact mode too.

## Should fix (minor)

- **V3:** `knowledge-documents-client.tsx:99-104`. Renaming a file doc on `/knowledge` does not dispatch `ppk:changed`. The plaque stays «утверждена» and nobody is asked again.
- **V4:** `structure-print.server.ts:88-102,200-205`. The 80 MB scan budget also covers text docs and formats printed as a line. Once it runs out, an approved text instruction prints «Не заполнено».
- **V5:** `structure-pdf.ts:297-301`. In the 3.7 «Подпись» cell the date is in Moscow time; «Отметка» uses the organisation's time zone. The cell shows no time.
- **V6:** `signature.ts:8,22-31`. A blank 600×200 PNG (823 B) is accepted as a signature. A 4000×4000 PNG is allowed (70 KB file, 64 MB decoded in jsPDF).
- **V7:** `revisions/route.ts:37-40` and `ppk-docs-list.tsx:21-24,58`. `knowledge:` approvals are gated by PPK access, but Р5 says knowledge managers. For head_chef/technologist, app 6 gets 403 and shows an empty «нет инструкций» with manage buttons that fail.
- **V8:** register (`revisions/route.ts:18-21`, `revisions/page.tsx:32`). It is not filtered for point-scoped managers.
- **V9:** `revisions.server.ts:219-243`. Two concurrent approvals of the same content can give it two numbers.
- **V10:** `acknowledgements/ppk/file/route.ts:45-46`. The heavy PDF rebuild on every employee request has no rate limit.
- **V11:** `knowledge-documents-client.tsx:39` and `revisions/route.ts:22`. At most 300 keys are read. A long GET URL gives 431 once there are about 400 docs.
- **V12:** `structure-print.server.ts:186`. A 2.1 policy that was never saved prints «Не заполнено» instead of the template the panel offers.
- **V13:** Р5 «Сотрудник видит номер редакции». The revision code is not shown to employees on `/knowledge` or `/acknowledge`.
- **V14 (cosmetic):** two items in the print. The `team-signed` legacy scans are neither printed nor hashed. The 2.4 scan's first page carries the generic header. The 3.7 hints still mention only the cabinet and the PIN code.

## Решения по раунду 1 (builder)

| # | Решение |
|---|---|
| V1 | Исправлено: `docxText` сначала проверяет `officeZipWithinLimits()` (тот же предел, что у предпросмотра базы знаний, 20 МБ распаковки); раздутый DOCX печатается строкой «не удалось вставить». Тест: DOCX на 24 МБ текста → `skip/broken`. |
| V2 | Исправлено: в строках списков (прил. 5, 6, `/knowledge`) рядом с номером — «утвердил …». |
| V3 | Исправлено: переименование файла на `/knowledge` шлёт `ppk:changed` — плашка перечитывается и спрашивает про новую редакцию. |
| V4 | Исправлено: документы текстом читаются всегда, предел 80 МБ — только для сканов. |
| V5 | Исправлено: колонка «Подпись» — в поясе организации и со временем, как «Отметка». |
| V6 | Исправлено частично: картинка подписи не больше 1600×800 (поле — 600×200), тест. Пустую подпись не пропускает клиент (кнопка недоступна до первого штриха); сервер проверяет PNG и размер, но не «белизну» картинки — это осталось ограничением. |
| V7 | Исправлено: (а) документ базы знаний утверждает только тот, кто управляет базой знаний (`admin.full`), иначе 403; (б) прил. 5/6 получают список с сервера — у кого нет права править, видят список и номера без кнопок. |
| V8 | Исправлено: руководителю точки реестр (страница и API) показывает свои и общие документы, без текстов и процедур других точек. |
| V9 | Исправлено: утверждения организации идут по очереди (`pg_advisory_xact_lock` в транзакции) — одна редакция не получит два номера. |
| V10 | Исправлено: файл программы для сотрудника — не чаще 6 раз в минуту на человека и 30 на организацию (429). |
| V11 | Исправлено: состояния редакций запрашиваются частями по 60 документов. |
| V12 | Исправлено: несохранённая политика 2.1 печатается шаблоном, как предлагает окно. |
| V13 | Исправлено: на странице ознакомления — «Редакция ППК 004 от …» у инструкции, политики и положения о группе, если текст не менялся после утверждения. В списке `/knowledge` для сотрудников номер не показывается (считать отпечатки всех файлов на каждый просмотр — дорого) — ограничение. |
| V14 | (б) колонтитул первой страницы скана 2.4 — приказа; (в) подсказка 3.7 упоминает подпись пальцем. (а) старые подписанные сканы «team-signed» в печать не идут — как в окне пункта (там это «прежние файлы»); ограничение. |
| Подписи коллег в PDF | По решению Р9: печатный лист ознакомления, как бумажный, содержит подписи всех; файл программы видят только сотрудники из аудитории документа. |

## Раунд 2 (свежая проверка, 2026-11-24)

Вердикт: **PASS**. Проверена ревизия HEAD 8c53aab7c, рабочее дерево чистое. Все AC1–AC10 — PASS (у AC10 — локальная часть; выкладка и прод проверке не доступны). Блокирующих и серьёзных замечаний нет. Подробности — в `verdict.json`.

Прогоны: `npm run typecheck` — exit 0. `npx eslint` по 43 изменённым .ts/.tsx — 0/0. Запрошенные юнит-тесты — 32/32. Тесты `src/lib/ppk` и связанные PDF-тесты — 251/251. Отбор `test-changed --range 6d58f5a98..HEAD` (70 файлов) — 312/312. `npm run i18n:check` — 103/103. Отдельно собран свой образец PDF на 30 страниц: все 36 строк «Содержания» совпадают со страницами заголовков; «Стр. N из 30» стоит на стр. 2–30, на титульной его нет; колонтитулы с номерами редакций на месте; сканы, битый файл и подпись на своих страницах.

### Решения раунда 1: проверка

| # | Итог |
|---|---|
| V1 | Исправлено для честно размеченной «бомбы». Остаток — R2-1: общий для репозитория предохранитель обходится. |
| V2, V3, V5, V9, V10, V11, V12 | Исправлено, регрессий не нашёл. Блокировка в `approveRevision` устроена так же, как в других местах репозитория; стенд выдал номера ППК 001…005. |
| V4 | Частично. Документы текстом теперь читаются всегда. Файлы, которые печатаются строкой, по-прежнему тратят 80 МБ — R2-6. |
| V6 | Ограничение принимаю. Размер картинки ограничен. Пустую подпись не пропускает клиент; сервер её пропускает. |
| V7 | (а) Исправлено. (б) Список приходит с сервера, но номеров редакций у тех, кто только смотрит, нет — R2-2. |
| V8 | Исправлено. Мелочь — R2-8. |
| V13 | Номер редакции на странице ознакомления есть. Список `/knowledge` для сотрудников — ограничение, принимаю. Рядом новое мелкое замечание — R2-4. |
| V14 | (б) и (в) исправлены. Ограничение (а) принимаю: в окне пункта это тоже «прежние файлы». |

### Новые замечания (все minor)

- **R2-1.** `src/lib/ppk/structure-pdf.ts:78-81` проверяет DOCX через `officeZipWithinLimits` (`src/lib/knowledge-documents.ts:31`). Эта проверка верит размерам, которые записаны в центральном каталоге ZIP, а JSZip распаковывает файл целиком и только потом сверяет размер. Проба: DOCX на 1,2 МБ с заниженным размером `word/document.xml` проходит проверку, и `planPrintFiles` роняет процесс Node с кучей 1 ГБ (FATAL heap out of memory). Файл на 398 КБ даёт +457 МБ памяти. Тот же обход уже есть на master в `src/app/api/knowledge-documents/[id]/preview/route.ts:22-25`: те же руководители могут уронить сервер тем же файлом через предпросмотр. Поэтому для этой задачи — minor: печать дошла до уровня существующей защиты, как и просил раунд 1. Совет: один общий извлекатель для печати и предпросмотра, который распаковывает с жёстким потолком (поток с подсчётом байтов или `zlib.inflateRawSync(…, { maxOutputLength })`).
- **R2-2.** `src/components/production-control/ppk-docs-list.tsx:83`. При `canManage = false` ключи пустые, поэтому заведующая и технолог видят в прил. 6 список без номеров редакций. Это расходится с решением V7(б) и с Р5. Совет: запрашивать состояния всегда, а `canApprove` оставить равным `canManage`.
- **R2-3.** `src/lib/ppk/structure-pdf.ts:345-347`. Подпись вставляется в PDF без сжатия: подпись RGBA 600×200 добавляет около 350 КБ. Замер: 294 КБ без подписей, 646 КБ с одной, 7,36 МБ с двадцатью. Совет: `addImage(…, undefined, "FAST")`.
- **R2-4.** `src/app/(dashboard)/acknowledge/[docKey]/page.tsx:186-198`. У «Положения о группе» на странице показан общий шаблон, а номер редакции относится к сохранённому тексту или скану пункта 2.2. У политики со сканом отпечаток считается по скану, а на странице — текст, который могли изменить после утверждения. В итоге строка «Редакция ППК NNN» может стоять над неутверждённым содержимым.
- **R2-5.** Скорость, `src/lib/ppk/revisions.server.ts:63-71, 103-117`. Каждый запрос состояний считает в Postgres sha256 по полному содержимому каждого файла. Это происходит при каждом открытии `/knowledge`, при каждом `ppk:changed`, на окнах пунктов, страницах ознакомления и при каждой печати ППК. Совет: кэшировать отпечатки по (id, updatedAt, sizeBytes).
- **R2-6.** `src/lib/ppk/structure-print.server.ts:93-109`. ZIP, RAR, 7Z, XLS, XLSX, DOC и DOCX тратят те же 80 МБ и читаются в память. Из-за этого скан, который идёт после них, может напечататься строкой «не вставлен», хотя по Р7 предел относится только к сканам.
- **R2-7.** Мелочь, `acknowledge/layout.tsx:9`, `knowledge/layout.tsx:6`. Сотрудник получает на клиент весь `productionControl`, около 72 КБ, хотя нужно около 0,2 КБ строк.
- **R2-8.** Мелочь, `src/lib/ppk/revisions.server.ts:272-281`. После удаления процедуры другой точки её строка в реестре больше не отфильтровывается, и её название видят руководители всех точек.

## Решения по раунду 2 (builder, после вердикта PASS)

| # | Решение |
|---|---|
| R2-1 | Исправлено: `src/lib/office-text.ts` — `word/document.xml` ищется по центральному каталогу ZIP и распаковывается `inflateRawSync` с `maxOutputLength` 8 МБ; ложные размеры в заголовках не помогают. Им пользуются печатная ППК и предпросмотр базы знаний (там та же слабость была на master). Тесты: «бомба» 30 МБ с заявленными 1000 байт → null; обычный DOCX → текст. |
| R2-2 | Исправлено: номера редакций в прил. 5/6 видят все, кто открыл пункт; утверждают — только с правом правки. |
| R2-3 | Исправлено: подписи вставляются со сжатием (`FAST`). |
| R2-4 | Исправлено: строка «Редакция ППК …» на странице ознакомления — только у документов базы знаний (их страница показывает ровно утверждённое содержимое). |
| R2-5 | Исправлено: отпечатки содержимого кешируются по (id, время изменения, размер), Postgres хеширует файл один раз. Формула отпечатка документа текстом — по sha256 нормализованного текста (на проде редакций ещё нет). |
| R2-6 | Исправлено: архивы, таблицы и DOC печатаются строкой и в память не читаются; объём 80 МБ — только у печатаемых файлов. |
| R2-7 | Принято: страницам `/acknowledge` и `/knowledge` нужен `productionControl` целиком (границы сообщений режут только по верхнему уровню). |
| R2-8 | Исправлено: удалённый документ руководителю точки в реестре не показывается. |
