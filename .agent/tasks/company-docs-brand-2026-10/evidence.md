# Evidence — company-docs-brand-2026-10

Ветка `feat/company-docs`, worktree `D:/wt/company-docs`, база `wesetup_company` (локальная, 127.0.0.1:5432). Дата проверки: 2026-10-18.

Работа начата прошлым агентом (прерван по лимитам), доделана и проверена в этой сессии. Итог по критериям — ниже; сырые артефакты — `raw/`.

## Итог

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 Один блок сведений | PASS | `src/lib/document-org-block.ts` (чистый) + `document-org-block.server.ts`; `buildOrgSnapshot` = `toOrderOrgSnapshot(buildDocumentOrgBlock(...))`; тесты блока, порядка строк, шапки журнала — `raw/tests-affected.log` |
| AC2 Все генераторы на блоке | PASS | PDF журналов (`journalHeaderOrgText`), ППК (`ppk/print-org.ts`, `loadPpkPrintOrg` → блок, все 9 потребителей), приказы (PDF + лист редактора), портал проверяющего (2 страницы, сводка PDF, лист QR); КПП и телефон точки в шапке — тест + `raw/samples/journal-p1.png` |
| AC3 Редактируемые реквизиты | PASS | 6 аддитивных полей `Organization`; `ORG_PROFILE_FIELDS` + проверка КПП/ОГРН; PATCH; форма с подсказкой ЕГРЮЛ, «Вернуть из ЕГРЮЛ», живым предпросмотром — `raw/ui/form-documents.png`, `raw/ui/ui-check.json`; устаревший снимок другого ИНН не подмешивается — тест |
| AC4 Логотип в документах | PASS | PDF журнала/ППК/плана ХАССП/приказа/сводки — `raw/samples/*-p1.png`; SVG растеризуется (в т. ч. кириллический текст) — `raw/samples/journal-svg-p1.png` + тесты; HTML-листы, плакаты, QR-плакаты, портал — `raw/ui/*`; внешний `logoUrl` в PDF не читается — `isOwnUploadedLogo` + тест |
| AC5 Фирменный цвет | PASS | `document-brand.ts` (нормализация, контраст, затемнение); акценты только при заданном цвете — `print-colors.test.ts` (новый тест + все прежние ч/б тесты зелёные); подписи RU/EN/UZ приведены к поведению |
| AC6 Тесты | PASS | 104/104 в затронутых модулях (`raw/tests-affected.log`), i18n 82/82; полный прогон — pre-commit gate |
| AC7 Проверки и глазами | PASS | tsc 0 ошибок; eslint по изменённым — 0 новых ошибок; `prisma validate` OK; `db push` на `wesetup_company` — «already in sync»; PDF и HTML-примеры просмотрены (пути ниже) |

## AC1. Один блок сведений — PASS

- `buildDocumentOrgBlock({ org, point, documentConfig })` → `{ org, point, brand }`: полное/краткое наименование, название для шапки журналов (`resolveOrgJournalName`), ИНН, КПП, ОГРН/ОГРНИП (подпись по 15 цифрам или типу ИП), юр. и факт. адрес, руководитель (должность, ФИО), телефон, город; точка — название, подпись (`buildingLabel`), адрес, КПП, телефон из `Building`; брендинг — `logoUrl` и нормализованный цвет.
- Фиксированный порядок строк `DOCUMENT_ORG_ROW_ORDER` + `documentOrgRows`; компактная строка шапки журнала `journalHeaderOrgText`; строка реквизитов `documentOrgRequisitesLine`.
- `src/lib/orders/org-snapshot.ts`: `buildOrgSnapshot` собирается через блок; `cityFromAddress` переехал в блок и реэкспортируется (старые импорты работают). Снимок приказа получил необязательные `orgKpp`/`orgOgrn` (старые снимки читаются).
- Тесты: `document-org-block.test.ts` — 9 тестов (без правок, правки поверх снимка, снимок другого ИНН, без снимка, ОГРНИП, порядок строк, шапка журнала, строка реквизитов/снимок приказа, брендинг).

## AC2. Все генераторы на блоке — PASS

- PDF журналов: `document-pdf.ts` выбирает `DOCUMENT_ORG_SELECT`/`DOCUMENT_POINT_SELECT`, ячейка организации — `journalHeaderOrgText` (ручная сборка удалена). КПП точки заменяет КПП организации, телефон точки — «тел. …». Тест «КПП и телефон точки — в шапке документа точки» (pdfjs-текст первой страницы).
- ППК: `PpkPrintOrg` = `ppkPrintOrgFromBlock(block)`; `loadPpkPrintOrg` → `loadDocumentOrgBlock`; «1. Общие сведения» (страница и PDF) — `ppkGeneralInfoRows`; строка реквизитов листа и PDF — `ppkRequisitesLine`. Потребители: posters (2), worksheets, flowcharts print, policy print, team meetings, team regulation, floor-plans print, `assemble.server.ts` (PDF программы и плана).
- Приказы: страница редактора и `api/orders/[code]/pdf` — `loadDocumentOrgBlock` + `toOrderOrgSnapshot`; реквизиты в листе и PDF — `orderRequisitesLine` (ИНН, КПП, ОГРН, адрес). У изданного приказа реквизиты — из его снимка (как раньше), логотип и цвет — текущие.
- Портал проверяющего: `/inspector/[token]` (реквизиты — `documentOrgRows`), `/inspector/[token]/[code]`, сводка PDF `api/inspector/[token]/pdf`, лист `/inspector-sheet/[id]`; `inspectorOrgSelect` расширен `DOCUMENT_ORG_SELECT`.

## AC3. Редактируемые реквизиты — PASS

- Схема: `Organization.legalFullName`, `kpp`, `ogrn`, `legalAddress`, `directorName`, `directorPost` — все `String?`, только добавления.
- Правило: правка → иначе снимок `legalProfileJson`; снимок не перезаписывается (`refreshOrganizationLegalProfile` пишет только `legalProfileJson`/`legalProfileUpdatedAt`, правки не трогает). Снимок с другим ИНН игнорируется (`currentLegalProfile`).
- `ORG_PROFILE_FIELDS` + `parseOrganizationProfilePatch`: пробелы схлопываются, длины 300/500/200, пусто → null; КПП `^\d{4}[\dA-Z]{2}\d{3}$` (буквы причины с 2019 г.), ОГРН 13 или 15 цифр; ошибки → ключи формы `invalidKpp`/`invalidOgrn`. PATCH `/api/settings/organization` возвращает новые поля.
- Форма `organization-info-form.tsx`, секция `#documents` «Сведения для документов»: поле с плейсхолдером из ЕГРЮЛ, строка «Берётся из ЕГРЮЛ» / «В ЕГРЮЛ: …» + кнопка «Вернуть из ЕГРЮЛ», живой предпросмотр (шапка журнала + строки блока теми же функциями, что у PDF).
- UI-проверка: `raw/ui/ui-check.json` (`headerPreview`, `previewAfterEdit`, `previewAfterReset`), `raw/ui/form-documents.png`.

## AC4. Логотип в документах — PASS

- `pdf-logo.ts`: PNG — как есть; SVG — растр `@napi-rs/canvas` (высота 320 px, пропорции); битый файл → null (документ без логотипа). `drawPdfLogo` кладёт картинку один раз на документ (alias).
- Исправлено в этой сессии: текст внутри SVG-логотипа (кириллица, незнакомый или общий шрифт) печатался квадратиками — растеризатор берёт только первое имя семейства и подменяет незнакомое шрифтом без кириллицы. `resolveSvgFontFamilies` сводит `font-family` (атрибут, `style`, `<style>`, корень) к установленному семейству или к шрифту репозитория (DejaVu Sans / Liberation Serif). Тесты + `raw/samples/journal-svg-p1.png` (до исправления — «□□□□□ SVG»).
- `pdf-logo.server.ts`: только загруженный файл своей организации (`isOwnUploadedLogo`: путь `/api/org-assets/<свой id>/logo`); внешний http/https и чужой путь сервером не читаются (SSRF). Тест.
- PDF: журнал (ячейка организации полной шапки, только первая страница — продолжения с компактной шапкой), ППК и план ХАССП, приказ, сводка проверяющего — `raw/samples/`.
- HTML: листы ППК (как было), плакаты ППК, лист приказа в редакторе, QR-плакаты A4/A5 и наклейки, портал проверяющего (титул, страница журнала), лист с QR — `raw/ui/`.
- Без логотипа — ни одной картинки в PDF журнала/ППК/приказа (тест `imageCount === 0`).

## AC5. Фирменный цвет — PASS

- `document-brand.ts`: `normalizeBrandColor` (#rgb/#rrggbb/#rrggbbaa → #rrggbb), WCAG-контраст, `brandOnColor` (белый/тёмный текст на заливке), `brandInk` (затемнение светлого цвета для тонких линий до контраста 3:1), `brandTint`, `brandPalette`.
- Журналы: полоса 1,2 мм по верху полной шапки; приказ — линия под реквизитами (по центру листа, как текст шапки); сводка проверяющего — линия под заголовком; ППК — подложка шапок таблиц, рамки этапов блок-схем, полоса под реквизитами; плакаты ППК — маркеры (текст на маркере по контрасту); QR-плакаты — полоса `border-top`; HTML-листы — полоса `print-color-adjust: exact`.
- Без цвета: журналы, приказы, сводка — строго ч/б (все прежние тесты `print-colors.test.ts` зелёные); ППК и плакаты — прежние цвета WeSetup.
- Новый тест: при `brandColor` цвет в PDF журналов и приказа — только заливка вне текста (`op === "rg"`, не в текстовом блоке).
- Кабинет не перекрашивается (`brandColor` в UI кабинета не применяется). Подписи RU/EN/UZ: «Брендинг» (подзаголовок), подсказка цвета, ответ `PageGuide` (вопрос «Где видны логотип и фирменный цвет?» вместо «Что такое brandColor?»), подпись снимка ЕГРЮЛ, подсказка логотипа (PNG, JPG или SVG — JPG браузер переводит в PNG), под полем «ссылка на картинку» — что в PDF печатается только загруженный файл.

## AC6. Тесты — PASS

`raw/tests-affected.log` — 104/104: document-org-block, document-brand, document-logo-pdf (PNG/SVG для журнала, ППК, приказа; SSRF; шрифты SVG), print-colors (ч/б + акцент), organization-profile-patch, organization-profile-error-adapter, orders/render, ppk/pdf, ppk/posters, inspector-qr, qr-posters-*. `npm run i18n:check` — 82/82. Полный набор — baseline-gate в pre-commit.

## AC7. Проверки и глазами — PASS

- `npm run typecheck` (tsc --noEmit --skipLibCheck) — exit 0.
- `npx eslint` по 40 изменённым/новым файлам — ошибки только в сгенерированном `src/i18n/message-contract.d.ts` (8 × `no-empty-object-type`, столько же в HEAD), предупреждения — старые неиспользуемые переменные `document-pdf.ts`; новых нет.
- `npx prisma validate` — valid; `prisma db push` на `wesetup_company` — «already in sync».
- PDF-примеры (организация `e2e-org-loc`: логотип, цвет #c2410c, правки руководителя и юрадреса поверх снимка, точка с КПП и телефоном), генератор `raw/gen-samples.ts`:
  - `raw/samples/journal.pdf` / `journal-p1.png` — логотип, полоса, КПП и телефон точки;
  - `raw/samples/journal-svg.pdf` / `journal-svg-p1.png` — SVG-логотип с кириллическим текстом;
  - `raw/samples/ppk-program.pdf`, `haccp-plan.pdf` (+ `-p1.png`) — логотип, реквизиты блока, правки поверх ЕГРЮЛ, акцент;
  - `raw/samples/order.pdf` / `order-p1.png` — логотип, ИНН·КПП·ОГРН·юрадрес, линия, подпись нового руководителя;
  - `raw/samples/inspector-summary.pdf` / `-p1.png` — логотип, полный блок реквизитов, КПП в штампе.
- HTML-виды (`raw/ui-check.ts`, dev-сервер 3041): см. раздел UI ниже.

## UI-проверка

`raw/ui-check.ts` (Playwright, dev-сервер 3041, менеджер `loc-manager@e2e.local`), итог — `raw/ui/ui-check.json`, ошибок страниц нет:

- Форма: `raw/ui/form-documents.png` (поля с «Берётся из ЕГРЮЛ» / «В ЕГРЮЛ: …» + «Вернуть из ЕГРЮЛ», предпросмотр), `raw/ui/form-branding.png` (подписи цвета и логотипа, пояснение под ссылкой). Живой предпросмотр: `headerPreview` → правка КПП `770199001` сразу в шапке (`previewAfterEdit`) → «Вернуть из ЕГРЮЛ» снова `770101001` (`previewAfterReset`).
- QR-плакаты (печать Chromium → PDF → PNG): `raw/ui/qr-a4-p1.png`, `qr-a5-p1.png` — логотип и фирменная полоса; `qr-sticker-p1.png` — мини-логотип перед названием. Счётчики: логотипов 2/2/2, полос 2/2/0.
- Лист приказа (печать): `raw/ui/order-sheet-p1.png` — логотип, ИНН·КПП·ОГРН·юрадрес, фирменная линия.
- ППК (печать): `raw/ui/ppk-poster-p1.png` — логотип, полоса, маркеры фирменным цветом с белыми цифрами; `raw/ui/ppk-program-sheet-p1.png` — шапка с логотипом и реквизитами, полоса, «Общие сведения» из блока.
- Лист с QR для проверяющих (печать): `raw/ui/inspector-sheet-p1.png` — полоса, логотип, реквизиты блока.
- Портал проверяющего (без входа): `raw/ui/inspector-portal.png` — полоса, логотип, ИНН/КПП/ОГРН/юр. и факт. адрес/руководитель/телефон (`inspectorRequisites`).
- Маршрут логотипа: прямой вызов обработчика — 200 image/png; на dev-сервере — 200.

### Найдено и исправлено при печати HTML-листов

`raw/print-probe.ts` + `raw/ui/print-probe.json`, `raw/ui/probe-*-bg-{false,true}.png` (без и с «фоновой графикой»):

- Печать кабинета прячет все `header` (`globals.css`), а шапка листов ППК и плаката с логотипом и реквизитами была `<header>` — на бумаге логотипа и реквизитов не было. Теперь `div` (`ppk-print-sheet.tsx`, `poster-sheet.tsx`).
- Ч/б сброс печати кабинета (`app-theme.css`, `.app-shell *`) гасил фирменную полосу и маркеры, несмотря на `print-color-adjust: exact`. Фирменным акцентам добавлен существующий опт-аут `data-print-keep-bg` (полоса листа ППК и плаката, маркеры плаката — только при заданном цвете, линия листа приказа). Без цвета печать прежняя (маркеры WeSetup и раньше уходили в ч/б).

## Решения по ходу

- «Что нового» (`whats-new-notes.ts`, `whats-new-modal.tsx`) — прошлый агент правил оба файла; возвращены к HEAD по поручению (запись при сведении веток).
- Логотип в PDF — только свой загруженный файл (проверка id организации в пути), не любой путь `/api/org-assets/*`.
- SVG-шрифты — см. AC4: без этого кириллический текст в SVG-логотипе печатался квадратиками.
- Тест количества картинок не считает маску прозрачности PNG (`/SMask`) отдельной картинкой.
- Приказ: логотип и линия центрируются по листу, как текст шапки (раньше — по колонке текста со смещённым левым полем).
- КПП в форме — без цифровой клавиатуры (буквы в причине постановки).
- Шапки печатных листов ППК/плаката — `div` вместо `header`; фирменные акценты HTML-листов — `data-print-keep-bg` (см. «Найдено и исправлено при печати»).

## Окружение

- `@swc/core` (плагин next-intl) отказывается грузиться: кэш нативного модуля под `C:\Users\Two` не проходит проверку ACL (у `BSQL\Yaroslav` FullControl на профиль). Права не менялись; dev-сервер запущен с `SWC_NATIVE_BINDING_CACHE=C:\ProgramData\swc-two`.
- Playwright worktree ждёт сборку браузера 1217, установлена 1243 — `ui-check.ts` берёт установленную.
- `tsconfig.json` — автоправка Next dev (`.next-company/types`), возвращён к HEAD.
- Dev-сервер временами отвечал HTML-404 на маршруты внутри динамического сегмента (в т. ч. нетронутые: `api/journal-documents/[id]/entries`, `posters/[key]`); помогал `touch` файла маршрута (наблюдатель Turbopack на этом диске). К коду ветки не относится.
- `src/i18n/messages/{confirm,errors}/*.json`, `pricing-message-contract.d.ts` — только переводы строк после `node scripts/i18n-types.mjs`, содержимое не менялось, в коммит не входят.
