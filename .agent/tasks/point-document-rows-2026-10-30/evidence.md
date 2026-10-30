# Доказательства — журналы точки только своё (2026-10-30)

| AC | Статус | Где |
|---|---|---|
| AC1 | PASS | `src/lib/point-document-rows-sync.ts` `trimPointDocumentConfig` / `syncPointDocumentRows`; тесты «холодильники…», «поверка и обслуживание…», «климат…», «уборка…»; e2e: `raw/inspect.txt` — в конфиге холодильников точки А остался только её шкаф |
| AC2 | PASS | `visiblePointStaffEntries` (страница документа и `loadJournalDocumentPdfInput`); тест «гигиена…»; e2e: `raw/browser-check.txt` — Анна (А), Вера (все точки), Глеб (Б, отметился по QR) видны, Борис (Б) — нет; `raw/inspect.txt` — запись Бориса в БД осталась |
| AC3 | PASS | страница документа (до загрузки), `document-pdf.ts` (до загрузки), `(dashboard)/layout.tsx` — `syncOrganizationPointDocumentsSoon` (раз в 10 мин на организацию, без ожидания), крон `uv-lamp-running` — `syncAllPointDocumentRows` |
| AC4 | PASS | `src/lib/point-document-rows-sync.test.ts` (8 тестов), typecheck 0 ошибок, браузер на e2e-БД: `raw/browser-check.txt` ALL PASS (7), скриншоты `raw/cold-point-a.png`, `raw/hygiene-point-a.png` |
| AC5 | PASS | `whats-new-notes.ts` — категория «Журналы точки — только своё» (+ иконка в `whats-new-modal.tsx`) |

Ограничение: «чужим» считается оборудование, чей цех привязан к другой точке.
Оборудование из цехов без точки система считает общим — оно остаётся во всех
точках. Прод-БД прочитать не дали (классификатор), поэтому привязку цехов к
точкам у клиента не проверял.

eslint: в `[docId]/page.tsx` одна давняя ошибка `no-html-link-for-pages`
(экран выключенного журнала, строка с `<a href="/settings/journals">`), не из
этой правки.
