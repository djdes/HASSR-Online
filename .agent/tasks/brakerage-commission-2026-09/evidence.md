# Evidence — brakerage-commission-2026-09

Коммиты: ad64a1a1 (G), 702c1801 (защита строк, A, печать), 384e04f5 (B), 1abdedbd (E), 287bc4ec (C), f19c9e62 (D), 7f45b3d0 (F), + «Что нового».
e2e — локальная `wesetup_e2e`, dev на 3020, Chrome; снимки в `shots/`, результаты — `e2e/*.json`.

| AC | Статус | Доказательство |
|---|---|---|
| AC1 | PASS (journal-fill — e2e; equipment/room/task-fill — код + сборка) | smoke-qr: `.ok` после сохранения, нет «Дальше»; `shots/151-qr-bulk-done.png`; `SuccessCheck` в equipment/room/task-fill |
| AC2 | PASS | smoke-columns 7/7; юнит `journal-columns.test.ts` |
| AC3 | PASS | smoke-columns, probe-docs; `shots/141-signed-row.png` (8 колонок по форме) |
| AC4 | PASS | юнит нормализаторов; probe-perishable-qr: позиции с `good_quality`; smoke-qr: 6 оценок в списке |
| AC5 | PASS | smoke-templates 8/8; юнит `journal-column-templates.test.ts` |
| AC6 | PASS | smoke-dish-pool 7/7; юнит `dish-pool-code.test.ts` |
| AC7 | PASS | smoke-commission 11/11 (ростер без комиссии, привязка не слетает, колонка «Комиссия») |
| AC8 | PASS | smoke-signatures 13/13 (409 unsigned-rows, 403 не члену, подпись «вход в кабинет», закрытие после подписи, устаревшая вкладка не стирает подпись); юнит `brakerage-commission.test.ts` 7/7 |
| AC9 | PASS | smoke-qr: «Несколько блюд» → 3 строки, «Добавлено: 3»; probe-perishable-qr: 2 позиции; юнит `parseBulkNames` |
| AC10 | PASS | smoke-qr 18/18: PIN один раз, «Подписано: 3», метод qr, 3 SignatureEvent, подмена наименования комиссией отклонена, редактор правит и удаляет с подтверждением; 390px без горизонтальной прокрутки |
| AC11 | PASS | `brakerage-row-merge.test.ts`; smoke-signatures (устаревшее сохранение не стирает подпись) |
| AC12 | PASS | test gate 1603/0; typecheck чистый; eslint изменённых файлов — 0 ошибок; `NEXT_DIST_DIR=.next-parity npm run build` exit=0 (`parity-build.log`) |

Не сделано из «необязательных мелочей» плана: образец бланка DOCX на лендинге и демо-строки с весом.
