# Evidence — qr-codes-page-2026-09 (C1 страница + повторная проверка ядра C2–C4)

Дата: 2026-09-23. Стенд: dev http://localhost:3025, БД `localhost:5432/wesetup_e2e`.
Организации страницы: `e2e-org-qrp`, `e2e-org-qrp-loc` (`e2e/page-setup.ts`).
Ядро: `e2e-org-qrc`, `e2e-org-qrc-loc` (`e2e/core-setup.ts`, перезапущено заново).

## Критерии приёмки

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 вход с журнала: основные отмечены (у гигиены 2), дополнительные — не отмечены, активные с dateTo ≥ сегодня, бейдж «до ДД.ММ.ГГГГ» | PASS | page-e2e IN-01, IN-02 (прошлый документ не показан), IN-24 (бейдж «до 30.09.2026»), IN-25 (токен несёт документ и срок) |
| AC2 галка в 44px-строке-label, формат A4/A5/Наклейка `role="radiogroup"`, полоса «Выбрано: N · M листов», одна главная «Распечатать», неактивна при 0 | PASS | IN-27 (radiogroup, нет tablist, «Выбрано: 2 · 2 листа»), IN-28 (0 → disabled), VP-1 (цели ≥ 44px) |
| AC3 смешанная печать: A4 1/лист, A5 2/лист с линией реза, наклейки 12/лист; 1 A4 + 3 A5 + 13 наклеек = 5 страниц | PASS | unit `qr-print-layout.test.ts`; PR-1, PR-2 (корень в body, листы — прямые блочные дети, 250 мм, последний `break-after:auto`, без header/footer/nav/aside/table, SVG в мм), PR-3 `page.pdf({preferCSSPageSize})` = 5 стр. (`shots/print-mixed.pdf`) |
| AC4 PageGuide свёрнут (3 пункта + ссылка «Строгость журналов»), длинного абзаца нет, «Домен ссылок» только не на wesetup.ru | PASS | IN-29 |
| AC5 журналы объектов: основной QR + отмеченные наклейки, «формат для всех», без дополнительных, `doc=` фильтрует; скан основного — статус без ссылок; нет объектов — «Ответственный …» + вход | PASS | IN-13, IN-15, IN-17, IN-23 (фильтр doc), IN-14 (пусто); ядро C3-1a/b, C3-2a/b (повторно PASS) |
| AC6 первый документ по основному QR (1 из 5 параллельных, аудит, уведомление), hub и документные — нет, защиты | PASS | ядро C4-1a/b/c, C4-2, C4-2b, C2-5a/b, C2-6a/b (повторный прогон 32/32) |
| AC7 просроченный доп. QR — 410 без ссылок, подмена даты → bad-sig, старые токены как раньше | PASS | ядро C2-1a…f, C2-3 |
| AC8 submit не принимает чужой documentId | PASS | ядро C2-4a…d |
| AC9 УФ нельзя заполнить из «Все журналы», набор из `JOURNAL_OBJECT_QR_KINDS` | PASS | ядро C3-1c/d, C3-3a/b/c; unit `journal-fill-scope.test.ts` |
| AC10 все старые входы дают ожидаемый предвыбор; `parseQrPostersRequest` покрыт тестом на каждый вход | PASS | unit `qr-posters-request.test.ts` (20 тестов); e2e IN-01…IN-23 (journal-list-actions, document-actions-bar, qr-fill-preview A4/Наклейка/Все коды + autoprint=1, выделение холодильников, меню климата/холодильников, баннер гигиены, /settings/equipment, /settings/buildings, старый qr-sheet, бывший редирект объектных журналов) |
| AC11 диалог QR документа: сначала основной («Код бессрочный»), затем QR документа «до ДД.ММ» | PASS | DLG-1, `shots/dialog-document-qr-1280.png` |
| AC12 самый длинный URL (hygiene@verify + документ + &view=all, 200 символов) читается с наклейки 34 мм; каждый напечатанный QR декодируется в свой data-qr-url | PASS | PR-6 (ZXing, 96 dpi — грубее принтера), PR-4/PR-5 (17 кодов, ≈288 dpi) |
| AC13 typecheck, lint без новых ошибок, npm test зелёный, тесты обновлены/добавлены | PASS | typecheck чисто; eslint изменённых файлов — 0 ошибок (1 старое предупреждение в `journal-selection-bar.tsx:65`, код до правки); npm test 2080/2080 |
| AC14 360/390/1280 светлая/тёмная: нет горизонтального скролла, цели ≥ 44px | PASS | VP-1 (3 экрана × 3 ширины × 2 темы), `shots/page-*-{360,390,1280}-{light,dark}.png` |

## Изменённые файлы (C1)

Новые:
- `src/app/(dashboard)/settings/qr-posters/qr-poster-card.tsx` — QrMainCard / QrCompactRow / QrObjectCard
- `src/app/(dashboard)/settings/qr-posters/qr-format-switch.tsx` — radiogroup A4/A5/Наклейка
- `src/app/(dashboard)/settings/qr-posters/qr-print-sheets.tsx` — печатное дерево (портал в body)
- `src/lib/qr-posters-request.ts` (+ `.test.ts`) — `parseQrPostersRequest`
- `src/lib/qr-print-layout.ts` (+ `.test.ts`) — `composeQrPrintPages`, `sheetsLabel`
- `src/lib/qr-posters-view.ts` — серверная сборка групп

Изменённые:
- `src/app/(dashboard)/settings/qr-posters/page.tsx` — парсер + view, редирект объектных журналов убран
- `src/app/(dashboard)/settings/qr-posters/qr-posters-client.tsx` — состояние, группы, полоса, autoprint после гидратации
- `src/lib/qr-fill-types.ts` — поля QrPoster (journalCode, documentId, validUntil, periodLabel), QrPosterItem, QrPrintFormat
- `src/lib/qr-fill-poster.ts` — `loadMainJournalQrNotices` («создастся при первом сканировании»), `formatPeriodLabel`, документный QR со сроком и основной с точкой в `loadQrPoster`
- `src/lib/journal-qr-target.ts` (+ test) — `journalQrHref` → `?journal=<код>[&doc=]`
- `src/app/api/qr-fill/[kind]/[id]/route.ts` — активная точка для основного QR журнала
- `src/components/qr/qr-fill-preview.tsx` — heading/accent/allHref, «Действует до ДД.ММ»
- `src/components/journals/document-actions-bar.tsx` — диалог: основной QR, затем QR документа
- `src/components/journals/journal-selection-bar.tsx` — опции placement="bottom", keepWhenEmpty, label (обратно совместимо)
- `src/components/ui/page-guide.tsx` — опциональный `footer`
- `src/lib/route-titles.ts` — «QR-коды»

E2E: `e2e/page-setup.ts`, `e2e/page-e2e.ts`, `e2e/page-state.json`, `e2e/page-e2e.json`.

## Команды

- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` — чисто
- `npx eslint <изменённые>` — 0 ошибок
- `npm test` — 2080 pass, 0 fail
- `npx tsx .agent/tasks/qr-codes-page-2026-09/e2e/page-setup.ts && BASE=http://localhost:3025 npx tsx .agent/tasks/qr-codes-page-2026-09/e2e/page-e2e.ts` — 39/39 PASS
- `npx tsx .agent/tasks/qr-codes-page-2026-09/e2e/core-setup.ts && BASE=http://localhost:3025 npx tsx .agent/tasks/qr-codes-page-2026-09/e2e/core-e2e.ts` — 32/32 PASS (повторно)

## Скриншоты

`shots/page-{hygiene,cold,overview}-{360,390,1280}-{light,dark}.png`, `shots/dialog-document-qr-1280.png`,
`shots/print-mixed-media.png`, `shots/print-mixed.pdf`, `shots/print-sticker-longest.png`, ядро — `shots/core-*.png`.

## Открытые вопросы

- Вход `?journal=<код>&doc=<id>` у обычного журнала: строка документа поднимается первой и подсвечивается,
  но не отмечается (по AC1 дополнительные не отмечены). Старые ссылки `ids=код:док` отмечают ровно этот документ.
- Старый e2e `.agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/qr-e2e.ts` (C-1…C-4) проверяет прежний вид
  `journalQrHref` (`kind=…&ids=…`) — теперь адрес `?journal=`; его ожидания нужно обновить (не мой файл).
- Гидратационное расхождение radix-id в шапке кабинета (DropdownMenu в `header.tsx`) видно в dev-оверлее на
  любой странице — не относится к странице QR, header не трогал.
- ZXing-js капризен к шагу модуля: декодер e2e пробует масштабы 1/2/3 и белое поле вокруг кадра (как камера).
  Наклейка 34 мм с самым длинным URL читается даже при 96 dpi; модуль на бумаге ≈ 0,55 мм.
