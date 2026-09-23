# Evidence — inspector-qr-2026-09 (QR для проверяющих)

Дата: 2026-09-23. Стенд: dev http://localhost:3025, БД localhost:5432/wesetup_e2e, организация e2e-org-insp.

## Критерии приёмки

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 | PASS | smoke AC1-1..AC1-4: QR создаётся в кабинете (срок 7 дней, заметка), SVG-превью, адрес /inspector/<43 символа>; строка: periodTo 2099-12-31, periodFrom = сегодня − 12 мес.; лист A4 /inspector-sheet/<id> печатается дважды с тем же QR (page.pdf, 1 страница, кириллица); после «Отозвать» (ConfirmDialog) — экран «Доступ отозван», листы 410. Скрины 01–04, 16. |
| AC2 | PASS | smoke AC2-1..AC2-6: без входа 200, реквизиты (ИНН, адрес, генеральный директор из legalProfileJson); пресеты «Сегодня/7 дней/Месяц/Квартал», свои даты зажимаются окном 23.09.2025–23.09.2026; опись по группам СанПиН/ХАССП/прочие со счётчиками; fryer_oil (отключён) отсутствует. Скрины 05, 06. |
| AC3 | PASS | smoke AC3-1..AC3-3: журнал листами PNG 1600px из generateJournalDocumentPdf (все страницы, кэш LRU 128 МБ по версии документа+записей); PDF документа скачивается (%PDF, текст «Гигиенический…»); чужой документ, вне окна, отключённый журнал (PDF, PNG, страница), несуществующий лист и токен — 404. Скрины 07, 09, 10, 11. |
| AC4 | PASS | smoke AC4-1: после листов каждого документа — штамп «ДОКУМЕНТ СФОРМИРОВАН В ЭЛЕКТРОННОМ ВИДЕ» (организация, ИНН, журнал, период, время, ответственный, контрольный код XXXX-XXXX-XXXX) и круглая отметка «WeSetup · электронный журнал ХАССП» с подписью «Отметка системы, не печать организации». Скрин 08. |
| AC5 | PASS | smoke AC5-1..AC5-5: «Кто смотрит» → InspectorVisit + cookie; AuditLog inspector.view/download/introduce с kind summary_page, journal_page, document, document_pdf, summary_pdf, introduce и именем; accessCount растёт; визиты в кабинете («Последние просмотры»); 26 запросов PDF → 429 (лимит 20/мин, страницы/листы 300/мин). Скрин 14. |
| AC6 | PASS | smoke AC6-1, AC6-2: сводный PDF и сертификат через registerUnicodeFont — текст извлекается pdfjs («Гигиенический журнал», «ДОКУМЕНТ СФОРМИРОВАН…», «СЕРТИФИКАТ», «Кафе «Проверка»»); два скачивания сертификата: токенов +1, затем +0 (переиспользует действующий QR). Файлы 12-summary.pdf, 13-certificate.pdf. |
| AC7 | PASS | smoke AC7-1: scrollWidth ≤ clientWidth на 390 и 1280 (опись, журнал, кабинет 390). Скриншоты просмотрены вручную. |
| AC8 | PASS | typecheck зелёный; eslint изменённых — 0 ошибок; npm test 2080/2080; smoke 22/22 PASS (e2e/smoke.json). |

## Изменённые / новые файлы

Новые:
- src/lib/inspector-qr.ts (+ .test.ts) — вывод токена HMAC (scope inspector-qr), окно, период, пересечение, контрольный код
- src/lib/byte-lru.ts (+ .test.ts) — LRU с лимитом по байтам
- src/lib/journal-preview/render-pages.ts (+ .test.ts) — растеризация любой страницы PDF
- src/lib/inspector-access.ts — токен, лимиты, журнал действий, проверка документа
- src/lib/inspector-doc-sheets.ts — кэш PDF/PNG по версии документа
- src/lib/inspector-journals.ts — опись со счётчиками
- src/lib/inspector-page.ts — общий вход публичных страниц
- src/lib/inspector-qr-service.ts — выпуск QR, SVG, данные кабинета, QR для сертификата
- src/app/api/inspector/[token]/documents/[id]/pdf/route.ts
- src/app/api/inspector/[token]/documents/[id]/pages/[n]/route.ts
- src/app/inspector-sheet/[id]/page.tsx, print-button.tsx — лист A4
- src/components/inspector/{paper,period-picker,electronic-mark,sheet-viewer,viewer-name-form}.tsx

Изменённые:
- src/app/inspector/[token]/page.tsx, [code]/page.tsx — «бумажный» портал
- src/app/api/inspector/[token]/pdf/route.ts — кириллица, период, отметка, лимит, аудит
- src/app/api/inspector/[token]/sign/route.ts — «кто смотрит», лимит, cookie, аудит
- src/app/api/certificate/route.ts — кириллица, переиспользование QR
- src/app/api/settings/inspector-tokens/route.ts — mode: "qr", визиты, аудит отзыва
- src/app/(dashboard)/settings/inspector-portal/page.tsx, inspector-portal-client.tsx — карточка QR, визиты
- src/lib/journal-preview/render.ts — только export двух путей pdfjs (поведение не менялось)

E2E: .agent/tasks/inspector-qr-2026-09/e2e/setup.ts, smoke.ts, state.json, smoke.json.

## Команды

- NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck — OK
- npx eslint <изменённые> — OK
- npm test — 2080 pass, 0 fail
- npx tsx .agent/tasks/inspector-qr-2026-09/e2e/setup.ts
- BASE=http://localhost:3025 npx tsx .agent/tasks/inspector-qr-2026-09/e2e/smoke.ts — 22/22 PASS

## Скриншоты

.agent/tasks/inspector-qr-2026-09/shots/: 01–02 кабинет, 03–04 лист A4 (+ PDF), 05–06 опись 390/1280, 07–09 журнал на телефоне, отметка, лист крупно, 10–11 журнал 1280, 12 сводный PDF, 13 сертификат, 14–15 кабинет с визитами 1280/390, 16 «Доступ отозван».

## Открытые вопросы

- Загрузка своей печати и факсимиле организации — следующий шаг (в MVP не делали, отметка системы явно подписана «не печать организации»).
- Лимиты и кэш — в памяти процесса (один PM2-процесс); при нескольких нодах нужен общий стор.
- Журнал показывает до 12 последних документов за период (каждый — отдельный PDF); для «года» по ежемесячным журналам проверяющему придётся сузить период.
- Для журналов-таблиц (бракераж и т. п.) строки хранятся в документе, а не записями: в описи показываем «N док.» без «нет записей».
- Сертификат переиспользует QR, срок которого ещё > 7 дней; иначе выпускает один «до отзыва».
