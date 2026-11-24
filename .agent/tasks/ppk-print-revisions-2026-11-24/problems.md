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
