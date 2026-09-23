# Evidence — brakerage-commission-qr-2026-09

Дата: 2026-09-23. Стенд: `http://localhost:3025`, БД `localhost:5432/wesetup_e2e`.

## Критерии приёмки

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 | PASS | `smoke-member-list.ts`: член из «Нового человека» → PIN → список «За сегодня» (радио `adm:`, нет формы «Несколько блюд») → «Подписать · 1» → «Подписано: 1», подпись в строке, метод `qr`. Член только в составе организации, копия документа пустая → список, «Подписано: 1», копия досинхронизирована (добавлен только он). Юнит `brakerage-qr-role.test.ts` (копия документа / только организация). Скрины `shots/02`, `03`, `05`. |
| AC2 | PASS | `smoke-member-list.ts`: POST `/members` → в ответе `members`, человек в `journalCommissionJson.finished_product` и в `config.commissionMembers` документа без «Сохранить состав»; затем проходит AC1. `smoke-qr.ts` (создание + PUT состава) 19/19 — двойного добавления нет. |
| AC3 | PASS | `smoke-member-list.ts`: должность «Член бракеражной комиссии» без состава → плашка «Вас нет в утверждённом составе…» (цвета `rgb(255,248,235)` / `rgb(161,109,50)`), нет формы, радио и полей оценки; прямой POST `adm:…=yes` → 403, подписи нет. Юниты: `brakerage-qr-role.test.ts` (viewer, вид `list`), `brakerage-qr-post.test.ts`, `brakerage-qr-html.test.ts`. Скрин `shots/04`. |
| AC4 | PASS | `smoke-member-list.ts`: повар на «Несколько блюд» (`bulk=1`) → «Сменить» → член комиссии → PIN → список (`#bk-form`), в адресе нет `bulk`, нет `view=add`. Скрин `shots/07`. |
| AC5 | PASS | `smoke-member-list.ts`: `qrFillMode=auth` + `commission=1`, без сессии → шаг PIN (`#qr-pin`), списка нет; после PIN — список. Юнит `qr-pin-gate.test.ts` (с сессией и обычный `auth` — как было). Скрин `shots/09`. |
| AC6 | PASS | Юнит `brakerage-grade-wording.test.ts` (перевод, регистр, «Не доброкачественная», свои оценки, снимок и оценка подписи без ложного «изменено после подписи»). `smoke-member-list.ts`: старые записи «Доброкачественная» / «Не доброкачественная» на сайте, в PDF (текст через pdfjs) и в QR показываются новыми словами. `grep -rn "брокачественная" src` — только комментарии и тест со старыми значениями. |
| AC6a | PASS | Юнит `brakerage-times.test.ts` (цепочка при добавлении, коррекция неподписанной/подписанной, текст подписи). `finished-entry.ts`: «Добавить списком» — полей бракеража/разрешения нет, подпись «Бракераж — 12:45, разрешение к реализации — 12:50», строки 12:40/12:45/12:50; «Добавить изделие» 09:05 → 09:10/09:15. `smoke-member-list.ts`: QR «Несколько блюд» 12:40 → 12:45/12:50 сразу; редактор меняет изготовление неподписанной на 13:00 → 13:05/13:10; у подписанной время бракеража/разрешения не пересчитано. |
| AC7 | PASS | typecheck 0 ошибок; eslint изменённых файлов — 0 ошибок (1 старое предупреждение `DOC_PAPER_HEADER_CARDS_HIDDEN_CLASS`); `npm test` 1998/1998; смоуки: `smoke-member-list` 24/24, `smoke-qr` 19/19, `smoke-signatures` 15/15, `smoke-commission` 11/11, `finished-entry` 20/20. |

## Изменённые файлы

Продукт:
- `src/lib/brakerage-qr-role.ts` — роль `viewer`, запасная проверка по составу организации.
- `src/lib/brakerage-qr-access.ts` (новый) — серверное определение роли (состав организации, категория должности).
- `src/lib/brakerage-commission-org.ts` — `addOrgCommissionMember`, `syncDocCommissionMember` (под `withDocumentConfigLock`, только добавление).
- `src/lib/brakerage-qr-flow.ts` — отказ 403 на POST от viewer, досинхронизация копии перед подписью.
- `src/lib/brakerage-qr-html.ts` — список только для чтения с амбер-плашкой; исправлена ложная метка «изменено после подписи».
- `src/lib/qr-pin-gate.ts` — `commissionOnly`: PIN в режиме `auth` без сессии.
- `src/app/journal-fill/[orgId]/[code]/route.ts` — роль через `resolveBrakerageQrAccess`, список комиссии по составу документа или организации, `view`/`bulk` не переносятся на другого человека, `commissionOnly` в шаге PIN.
- `src/app/api/settings/brakerage-commission/[code]/members/route.ts` — «Новый человек» сразу в составе, ответ с `members`.
- `src/components/journals/commission-dialog.tsx` — список из ответа сервера, `onSaved`.
- `src/lib/brakerage-grade-wording.ts` (новый) — `modernizeGradeWording`.
- `src/lib/finished-product-document.ts`, `src/lib/brakerage-commission.ts` — новые слова, перевод старых при нормализации (строки, свои оценки, подписи).
- `src/lib/brakerage-qr.ts`, `src/lib/perishable-rejection-document.ts`, `src/components/journals/perishable-rejection-document-client.tsx`, `src/lib/journal-default-pipelines.ts`, `src/lib/tasksflow-adapters/perishable-rejection.ts`, `src/app/task-fill/[taskId]/page.tsx` — подписи оценок.
- `src/lib/brakerage-times.ts` — `chainBrakerageTimes`, `correctedBrakerageTimes`, `brakerageChainCaption`.
- `src/lib/tasksflow-adapters/finished-product.ts` — время бракеража и разрешения сразу в новых строках QR.
- `src/components/journals/finished-product-document-client.tsx` — окно добавления (одно и списком): только изготовление и живая подпись цепочки.

Тесты: `src/lib/brakerage-qr-role.test.ts`, `src/lib/qr-pin-gate.test.ts`, `src/lib/brakerage-times.test.ts`, `src/lib/brakerage-grade-wording.test.ts` (новый), `src/lib/brakerage-qr-html.test.ts` (новый), `src/lib/brakerage-qr-post.test.ts`.

Смоуки: `.agent/tasks/brakerage-commission-qr-2026-09/e2e/smoke-member-list.ts` (новый), `.agent/tasks/brakerage-commission-2026-09/e2e/smoke-qr.ts`, `.agent/tasks/brakerage-commission-2026-09/e2e/smoke-signatures.ts`, `.agent/tasks/finished-product-entry-2026-09/e2e/finished-entry.ts`.

## Команды

| Команда | Результат |
|---------|-----------|
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | exit 0 (первые два запуска падали на чужих файлах в работе: `locations-summary-strip.tsx`, `screenshot-fan`) |
| `npx eslint <изменённые файлы>` | 0 ошибок, 1 старое предупреждение |
| `npm test` | 1998/1998 |
| `BASE=http://localhost:3025 npx tsx .agent/tasks/brakerage-commission-qr-2026-09/e2e/smoke-member-list.ts` | 24/24 PASS |
| `… smoke-qr.ts` | 19/19 PASS |
| `… smoke-signatures.ts` | 15/15 PASS |
| `… smoke-commission.ts` | 11/11 PASS |
| `… finished-entry.ts` | 20/20 PASS |

## Диагноз finished-entry (было 6/8)

Тест устарел, это не регресс. С 702c1801 (21.09) новый документ бракеража — форма Приложения 4: колонки «Ответственный исполнитель» в нём нет, а «Органолептическая оценка» называется «Результаты органолептической оценки качества готовых блюд». `responsibleIdx` и `organoIdx` были -1, `nth(-1)` брал чужую ячейку. Тест теперь включает колонку ответственного в своём документе и ищет колонку оценки по `/органолептическ/i`. Если колонки нет, тест падает с понятной ошибкой. Подсказки ФИО в ячейке работают: 20/20.

## Смоуки: что поправлено

- `smoke-signatures.ts`: модалка z-[80] — это не гайд, а «Мы обновили условия» (`legal-update-modal`). Условия принимаются заранее через `/api/legal/accept`, гайд отмечается увиденным через `/api/me/notices`. В `finally` возвращаются `legalVersion`, `seenNoticesJson` и записи `LegalConsent`.
- `smoke-qr.ts`: PIN берётся из `#qr-pin`; подпись — радио `adm:<id>` и кнопка «Подписать · 3»; правка — `action=save`; удаление в том же визите (с `f`).
- Смоуки восстанавливают все активные документы готовой продукции организации: состав копируется в каждый из них.

## Открытые вопросы

- Если закрыть окно «Сторонняя бракеражная комиссия» после «Нового человека» без сохранения, несохранённые правки ролей и удаления в окне пропадут. Человек и так уже в составе.
- На стенде `qrFillMode` организации e2e-org-a = `auth` (так было до прогона, и значение возвращено).
