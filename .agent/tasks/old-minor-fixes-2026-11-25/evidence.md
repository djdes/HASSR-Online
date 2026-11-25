# Evidence — old-minor-fixes-2026-11-25 (раунд 2)

Ветка `claude/fervent-brown-ed5apv` от master dd898d487: правки 7120e112f, исправления по первой проверке 74b12baa0.
Первая свежая проверка — FAIL по AC8 (`verdict-round1.json`, `problems-round1.md`, `raw/verifier-round1/`): во
флекс-ряду скрепка 48 px сужала название, и на 320–390 px слова рвались посреди; плюс неблокирующее — `{ ids: [5],
employeeId }` удалял всю строку сотрудника. Оба исправлены (ниже). Каждая правка — сначала падающий тест
(TDD), потом код. Стенд — `next dev :3000` (как браузерный смоук в CI), локальный PostgreSQL, демо-организация
`admin@haccp.local`, повар `cook-e2e-special@haccp.local`.

## AC1 — удаление по сотруднику и дню: PASS

- `src/lib/journal-entry-delete.ts` — `entryDeleteTarget()`: `{ ids }` — эти строки, `{ employeeId, date }` — строка за
  этот день (полночь UTC), `{ employeeId }` — вся строка, неверная дата/пустой запрос — 400; непустой `ids` без
  единого корректного id (или не массив) — 400 «Некорректный список строк», а не «вся строка сотрудника». DELETE в
  `entries/route.ts` проверяет закрытые дни и удаляет по одному и тому же `target.where`.
- RED: `journal-entry-delete.test.ts` — модуля не было; GREEN; раунд 2 — RED на испорченном `ids`, GREEN 6/6.
- Стенд (`raw/stand/minor-fixes-e2e-output.txt`): документ автоматики, окно 3 дня, у руководителя строки 6 дней назад и
  вчера → удаление вчерашней по сотруднику и дню — 200 `{deleted:1}` (раньше 403 — проверка спецрежима,
  `ad6-probe`), строка 6 дней назад цела; её удаление — 403 `past_day_locked`; неверная дата — 400;
  `{ ids: [5], employeeId }` — 400, строки сотрудника целы (29→29).

## AC2 — перенос строки из будущего дня: PASS

- `journal-entry-write.ts`: запреты прошлых дней вынесены в `checkPastDayLocks`; `checkEntryWrite` = правило будущего +
  они; новый `checkEntrySourceWrite` — только они. PUT с `entryId` проверяет источник через `checkEntrySourceWrite`.
- RED: `journal-entry-source.test.ts` (функции не было, 3/3 падали); GREEN 3/3. Старое ожидание в
  `special-mode-past-days.test.ts` (источник через `checkEntryWrite`) обновлено — поведение меняется намеренно.
- Стенд: руководитель переносит строку с послезавтра на сегодня — 200 (было 403 `future_day_locked`, MV-12); запись в
  будущий день — 403 `future_day_locked`; повар свою строку с будущего дня — 403 `not_today`.

## AC3 — ESLint журналов: PASS

- `page.tsx` документа: `Link` вместо `<a href="/settings/journals">`, убраны неиспользуемые
  `ACCEPTANCE_DOCUMENT_TEMPLATE_CODE`, `SANITARY_DAY_CHECKLIST_TEMPLATE_CODE`; `climate-document-client.tsx` —
  `RecordCardItem`; `journal-entry-write.ts` — `isManagementRole`.
- RED: 1 ошибка + 4 предупреждения; GREEN: ESLint этих файлов (и новых) — exit 0 (`raw/eslint.txt`).

## AC4 — тест прокси без зависимости от `.env`: PASS

- RED: с `.env` 4/6 (на предзагрузке стоит гостевая кука `wesetup.visitor`), без — 6/6. Тест проверял «никаких кук», а
  он о куке языка. GREEN: проверка «нет `wesetup.site-locale=`» — 6/6 и с `.env`, и без (`raw/site-locale-proxy.txt`).

## AC5 — сравнение читает только нужное: PASS

- `pickCompareSides()` (`revisions.ts`) — выбор сторон вынесен из `compareRevisions` без изменения правил; история —
  без `content`, «есть ли текст» — запрос `content: { not: null }`, текст — только `number: { in: needed }`.
- `revision-minors.test.ts`: правила по умолчанию (изменён / не изменён / одна редакция / нет текста), заданные
  стороны, ошибки; проверка запросов в источнике.

## AC6 — текст редакции соответствует отпечатку: PASS

- `approveRevision`: текст — `readSnapshotWithRetry` (повтор, затем `console.error`, без `.catch(() => null)`), затем
  отпечаток перечитывается до транзакции; изменился — 409 «Документ изменился во время утверждения — утвердите ещё
  раз» (`doc_changed`), ничего не сохраняется.
- Тесты: повтор и лог на поддельных чтениях (успех сразу / со второго раза / сбой дважды), порядок «текст → перечитать
  отпечаток → транзакция» и текст 409 в источнике. Гонку правки и утверждения на стенде не воспроизводили.

## AC7 — ошибки ППК на языке интерфейса: PASS

- `src/lib/ppk/api-errors.ts`: коды сравнения, черновика и утверждения (+ доступ `forbidden`, `choose_point`),
  `ppkErrorText()` — перевод по коду, иначе текст сервера, иначе запасной. API и `requirePpkAccess` отдают
  `{ error, code }`; `revision-compare.tsx`, `text-doc-editor.tsx`, `revision-control.tsx` — перевод по коду.
- Тексты ru/en/uz (`productionControl.revisions.compare.errors`, `…structure.text.draftErrors`,
  `…revisions.errors`), `npm run i18n:types`; `npm run i18n:check` 103/103. Уточнение в spec: коды получило и
  утверждение — его новое сообщение 409 видно пользователю.
- Стенд: коды `bad_request`, `doc_not_found`, `no_revisions`, `ai_not_configured` (503), `forbidden` (повару) — как
  ожидалось; интерфейс на английском (язык профиля `en` на время проверки) — ошибка черновика «The AI assistant is
  not connected: drafts are unavailable right now».

## AC8 — скрепка рядом с названием объекта: PASS

- Раунд 1 (флекс-ряд значок/название/скрепка) проверка отклонила: скрепка 48 px (правило касания) отнимала ширину у
  названия, слова рвались посреди. Раунд 2 (`buildings-client.tsx`): на телефоне значок и название — обычный текст на
  всю ширину (`max-sm:inline`), скрепка — внутри заголовка, в `whitespace-nowrap` вместе с последним символом названия
  (`splitForPin`): не начинает строку одна; у заголовка `aria-label` с названием. С 640 px — отдельная скрепка
  `max-sm:hidden sm:order-last`, порядок «название, сфера, скрепка» как был. Склейку отдельным элементом (U+2060,
  NBSP) Chrome на этой странице всё равно переносил — проверено опытами на стенде; работает только nowrap-обёртка.
- Тест `buildings-card-layout.test.ts`: RED → GREEN 4/4 (разбиение по символам, в т. ч. эмодзи; разметка обеих скрепок).
- Стенд (`raw/stand/card-pin-before.json` / `card-pin-after.json`, длинное название): 320–430 px — скрепка в строке
  последнего слова (до: нет), разорванных слов нет, прокрутки нет; 700 и 1280 px — как раньше. Скрипт проверяющего на
  типичных названиях («Производственный цех №2», «Кондитерский цех», «Столовая «Берёзка»»…) — на 320–430 px ни одного
  разорванного слова (`raw/stand/card-typical-names-after.txt`; в раунде 1 — разрывы на 320–390 px).
- На компьютере не закреплённая скрепка, как и раньше, видна при наведении.

## AC9 — качество: см. ниже

- typecheck — exit 0 (`raw/typecheck.txt`); `test:gate` на 74b12baa0 — целевой режим, 80 файлов, 371/0
  (`raw/test-gate.txt`); ESLint 22 изменённых файлов — exit 0 (`raw/eslint.txt`); borderless пересобран (счётчик
  файлов), палитра без изменений.
- Стенд: `raw/stand/minor-fixes-e2e-output.txt` 22/22, замеры карточки — до/после. Спецрежим, язык руководителя,
  редакции ППК на стенде возвращены как были, точки сценария удалены.
- Схема БД не меняется.
