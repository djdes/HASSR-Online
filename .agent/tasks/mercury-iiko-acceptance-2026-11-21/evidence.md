# Evidence: Меркурий и iiko в журнале приёмки, история партии по ВСД

- **Task ID:** `mercury-iiko-acceptance-2026-11-21`
- **Branch:** `claude/hopeful-euler-lb6cie`, база слита с `origin/master` `efcf26193` (#289), конфликтов не было.
- **Verdict:** PASS по всем AC (см. таблицу); проверено заново после слияния с master.

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 | PASS | `src/lib/acceptance-sources.test.ts` (тесты 4–8 и последний тест файла): нет интеграции / выключена / нет в тарифе → `mercury: null` без подсчёта; включена → `{pending, overdue}` по фильтру `mercuryPendingWhere` (те же статусы, что «Входящие ВСД», своя организация, точка документа и общие); не руководитель → `null` без единого запроса; полоса только при `pending > 0`. Скриншоты `raw/01-strip-mobile*.png`, `raw/02-strip-desktop*.png` (полоса и `href=/mercury`), `raw/03-no-strip-empty.png` (pending 0 — без полосы), `raw/04-menu-mercury.png` (пункт «ВСД из Меркурия»), `raw/07-staff-menu.png` (сотрудник: ни полосы, ни пунктов). |
| AC2 | PASS | Тесты 9–10: `iikoTarget(true)` → `/edo`, `iikoTarget(false)` → `/settings/integrations/iiko`; ключи `journalAcceptance.iiko` = connect/connected/notConnected/openInbox/title на ru/en/uz, ни в одном нет «разработчик/developers/ishlab chiqvchi». Скриншоты `raw/05-iiko-connected.png` (кнопка во «Входящие накладные», `href=/edo`) и `raw/06-iiko-not-connected.png` (кнопка «Подключить iiko», `href=/settings/integrations/iiko`). |
| AC3 | PASS | `src/lib/batch-traceability.test.ts` (тесты 11–14): ссылка `/journals/<код шаблона>/documents/<id>` только для документа своей организации; строки ВСД с номером (или началом UUID), поставщиком, объёмом, датой, по хронологии; запросы страницы — `where: { organizationId, batchKey }`, `organizationId_code`, документы журналов по `organizationId`; чужая точка отсекается `pointRecordVisible`; ссылка «Открыть партию» — только при доступе к `/batches`. |
| AC4 | PASS | Тесты 10, 15, 16: тексты ru/en/uz; `npm run i18n:types` выполнен (`message-contract.d.ts` обновлён); `docs/MERCURY.md` — раздел «Журнал приёмки и прослеживаемость (21.11.2026)», в «Что ещё не сделано» — стадия 1 и оговорка про `JournalEntry`. `src/i18n/catalog-validation.test.ts` зелёный (одинаковые ICU-аргументы во всех языках). |
| AC5 | PASS | `raw/typecheck.txt` — 0 ошибок; `npm run test:gate` после слияния — 67 файлов, pass 297, fail 0; `raw/palette.txt` — `neutral-palette.test.ts` pass (палитра не изменилась: новые классы уже были в палитре); `raw/eslint.txt` — в изменённых файлах новых ошибок нет; одна ошибка `@next/next/no-html-link-for-pages` (строка 576 `page.tsx`, `<a href="/settings/journals">`) есть и на `origin/master` — не тронута как не относящаяся к задаче. |

## Уточнения при реализации (в рамках решений спеки)

- Оформлять ВСД (`POST /api/mercury/documents/[id]/process`) и принимать накладные из «Входящих» (`guardSupply`)
  может только руководство (`hasFullWorkspaceAccess`), поэтому подсказки грузятся только для него
  (`canManage`); сотруднику пункт «Добавить из iiko» больше не показывается — раньше он открывал заглушку.
- Чтобы история партии была досягаема: ссылки «История партии» на «Входящих ВСД» (у ВСД с `batchKey`) и на
  странице партии (`/batches/[id]`).
- Тот же экран показывает и журнал приёмки сырья, но строки из ВСД и накладных пишутся только в
  `incoming_control` (`mercury/process-incoming.ts`, `supply/documents.server.ts`). Поэтому подсказки — только в
  этом журнале (`receivesSupplyRows`, тест «подсказки — только в журнале, куда ложатся строки…»): в журнале
  сырья фраза «строка появится в этом журнале» была бы неправдой.
- Подпись пункта меню: «Добавить из Айко» → «Добавить из iiko» (en/uz — так же).
- Полоса на телефоне: иконка и текст сверху, кнопка во всю ширину снизу (первый вариант в одну строку сжимал
  текст до узкой колонки — `raw/01-strip-mobile.png` до правки, `raw/01-strip-mobile-strip.png` после).

## Не проверено вживую

- Страница истории партии рендерится сервером из базы; локальной базы нет, поэтому её вид не снят
  скриншотом — проверены данные (чистые функции) и запросы (тест по исходнику). Карточки страницы
  повторяют уже существующие на ней стили.
- Скриншоты сняты на временной странице-превью dev-сервера (удалена до коммита); ошибки консоли там —
  только об отсутствии локальной базы (кэш переводов).
