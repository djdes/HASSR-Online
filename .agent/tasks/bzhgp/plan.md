# План: БЖГП — время подписи комиссии = время бракеража + 1 минута

Ветка `feat/bzhgp-sign-time-2026-09-30`, рабочая копия `d:/wt/bzhgp`, база `wesetup_wt_bzhgp`, порт 3195.

## Что нашли (все места, где задаётся и показывается время подписи комиссии)

Задаётся — только на сервере, `signBrakerageRows` (`src/lib/brakerage-signatures.ts`): `signedAt = now`.
Вызывают его сайт/Mini App («Подписать выбранные», галочка в окне блюда — `api/journal-documents/[id]/sign`)
и QR-список комиссии (`brakerage-qr-flow.ts`, вход по ПИН). Подписи — серверное поле строки
(`brakerage-row-merge.ts`): клиент их не меняет, отдельного поля «время подписи» для правки нигде нет.

Показывается:
1. Таблица журнала на сайте — `SignaturesCell` → `formatRowSignatures` (`finished-product-document-client.tsx`).
2. Карточки на телефоне и в Mini App — `finishedProductCellText(row, "signatures")`. Mini App своих экранов
   не имеет: `/mini/documents/:id` ведёт на ту же страницу сайта.
3. Окно блюда, блок «Комиссия» — «подписал · ЧЧ:ММ» (`commissionRowStatus` + `signatureTime`).
4. Печать PDF — `drawFinishedProductPdf` → `finishedProductCellText` (`document-pdf.ts`).
5. QR-список «За сегодня» — «Подписано: … · ЧЧ:ММ» (`brakerage-qr-html.ts` → `formatRowSignatures`).
6. Word — у БЖГП только пустой образец для лендинга (`document-docx.ts`, `blankRegister`): строк и подписей
   в нём нет, выгрузки заполненного журнала в Word в продукте нет. Менять нечего — отмечу в отчёте.

Реальный момент подписи уже хранится: `signatures[].signedAt` (ISO), журнал подписей `SignatureEvent.createdAt`,
журнал действий `AuditLog journal.brakerage_sign` (только сайт; у QR-подписи записи в журнале действий нет).

## Решение

- Подпись получает новое поле `journalAt` — время подписи в журнале («ГГГГ-ММ-ДД ЧЧ:ММ» местное) = время
  бракеража строки + 1 минута на момент подписи. `signedAt` не меняется — это реальный момент для аудита.
- Время подписи в журнале считается одной чистой функцией `signatureJournalTime(signature, row, tz)`:
  - подпись по новому правилу (`journalAt` есть) → время бракеража строки + 1 минута. Поменяли время
    бракеража (окно блюда, таблица, «Применить к выбранным», QR у комиссии) — подпись идёт за ним:
    правило владельца «+1 минута к установленному времени бракеража»; бракераж стёрли — `journalAt`;
  - у строки нет времени бракеража → как сейчас: настоящее время подписи (при подписи `journalAt` не ставим);
  - старая подпись (без `journalAt`) → настоящее время, если оно не раньше бракеража и не позже, чем через
    X = 5 минут; иначе бракераж + 1 минута. X = 5 — столько по умолчанию проходит от бракеража до разрешения
    к реализации (`releaseAfterRejectionMinutes`): подпись в этом окне выглядит поставленной на бракераже,
    а подпись раньше бракеража или после разрешения к реализации (часто — утром следующего дня) — нет.
  - Данные в БД не переписываем.
- «ЧЧ:ММ» без даты в `rejectionTime` (так пишут «Повторить» и демо) — на дату изготовления; раньше
  изготовления — следующий день. Переход через полночь — `addMinutesToLocalDateTime`.
- Аудит: `journalAt` дописывается в `SignatureEvent.entryRef`; в журнал действий (`journal.brakerage_sign`)
  — реальный момент и время в журнале по строкам; QR-подпись тоже пишется в журнал действий (автор «… (QR)»).
- Лог `console.info("[brakerage-sign] …")` на подписи: документ, строка, кто, метод, реальный момент, время в журнале.

## Интерфейсы (чистые, сайт = сервер = QR)

`src/lib/brakerage-times.ts`
- `COMMISSION_SIGN_AFTER_REJECTION_MINUTES = 1`
- `rowRejectionDateTime(row: { rejectionTime?, productionDateTime? }): string` — «ГГГГ-ММ-ДД ЧЧ:ММ» | «ЧЧ:ММ» | ""
- `commissionSignDefaultTime(row): string` — бракераж + 1 минута | ""

`src/lib/brakerage-commission.ts`
- `BrakerageRowSignature.journalAt?: string`
- `LEGACY_SIGNATURE_WINDOW_MINUTES = 5`
- `signatureJournalTime(signature, row?, timeZone?): string` — «ЧЧ:ММ»
- `formatRowSignatures(signatures, timeZone?, row?)` — третий аргумент новый, без него — как раньше
- `commissionRowStatus(row, members, timeZone?)` — плюс `journalTime`

`src/lib/brakerage-qr.ts` — `BrakerageQrRow.rejectionAt` (полное время бракеража для подписи).
`src/lib/brakerage-signatures.ts` — `BrakerageSignResult` ok: плюс `signedAt` и `rows: [{ rowId, journalAt }]`.

## Файлы

- `src/lib/brakerage-times.ts`, `src/lib/brakerage-commission.ts` — правило и расчёт.
- `src/lib/brakerage-signatures.ts` — `journalAt` при подписи, `entryRef`, лог, итог для аудита.
- `src/app/api/journal-documents/[id]/sign/route.ts` — детали журнала действий.
- `src/lib/brakerage-qr-flow.ts` — журнал действий для QR-подписи.
- `src/lib/finished-product-document.ts` — ячейка «подписи» для карточек и печати.
- `src/components/journals/finished-product-document-client.tsx` — таблица, окно блюда, подсказка.
- `src/lib/brakerage-qr.ts`, `src/lib/brakerage-qr-html.ts` — QR-список.
- Тесты: `src/lib/brakerage-sign-time.test.ts` (новый), правка фикстуры `brakerage-qr-html.test.ts`.

## Проверки

- Юнит: +1 минута; полночь (и «ЧЧ:ММ» без даты); нет времени бракеража; правка вручную (бракераж поменяли —
  подпись идёт за ним; комиссия поправила бракераж при подписи); старые подписи (в окне 5 минут — как есть,
  раньше бракеража / позже — +1); `normalizeRowSignatures` хранит `journalAt`; ячейка, печать, QR-список.
- E2E (390 и 1280, headless Chromium, стенд :3195): строка с бракеражем 12:30 → член комиссии подписывает на
  сайте и по QR → подпись 12:31 в таблице, карточке (390), окне блюда, QR-списке, PDF (текст + картинка
  страницы); реальный момент — в `signedAt`, `SignatureEvent`, журнале действий; старая подпись не
  переписана в БД. Word — образец без строк (проверка содержимого файла).
- `npm run typecheck`, `npm test`.
- Скриншоты и `evidence.md` — в `.agent/tasks/bzhgp/`.
