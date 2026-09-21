# Evidence — journal-row-position

## Коммиты
- af07c95e — хелпер `getRowEmployeeTitle`, `jobPosition` в серверных выборках
  и `findTaskEmployee`, перештамповка без должности документа (AC5).
- 3b954b6e — микроклимат: сетка, диалоги, `entryId`, `displayEmployees`, PDF,
  автозаполнение (AC1–AC4).
- ad64a1a1 — (коммит соседней сессии, забрал мои застейдженные файлы через
  общий индекс) охлаждение, дезинсекция, прослеживаемость, СИЗ + их PDF (AC6).
- dd1f7072 — чек-лист проветривания, бракераж, металлопримеси, дезсредства
  (AC7). Содержит также незаконченные правки соседней сессии в файлах бракеража.
- 94e1ed6c — мойка оборудования, медкнижки, обучение, списание, «Что нового» (AC8).

## Тесты (красный → зелёный)
- user-roles.test.ts: getRowEmployeeTitle (3 теста; «нет человека» → "", не «Повар»).
- journal-staff-binding.test.ts: ненайденный человек не получает должность
  документа; перештамповка берёт jobPosition.
- journal-autofill.test.ts: климат — чужая строка без должности документа,
  своя строка ответственного — с ней (фейковый db).
- ppe-issuance-document.test.ts, pest-control-document.test.ts,
  cleaning-ventilation-checklist-document.test.ts,
  perishable-rejection-document.test.ts — должность из карточки.

## Прогоны
- pre-commit на каждом коммите: `npm run typecheck` чисто,
  `test:gate` pass=1591 fail=0 (последний коммит).
- `npx eslint` по изменённым файлам: 0 errors (предупреждения — существовавшие).

## Не сделано
- Ручная проверка в браузере (dev-сервер + БД) не проводилась.
