# Evidence: сведение веток кабинета (integ/sketch-wave)

Спецификация задачи — S3 в `D:\handoff\wesetup-2026-10-18\prompts\S3-release.md` (п. 1 «Принять сведение»). Критерии:
- **AC1** — в ветке все 6 веток данных и меню и дизайн-проход, конфликты решены.
- **AC2** — `prisma validate`, tsc, `i18n:check`, test gate, eslint по изменённым файлам без новых ошибок.
- **AC3** — смоук на dev-сервере (порт 3060, база `wesetup_integ`): ключевые страницы без ошибок.
- **AC4** — `verify-worktree` = 0 испорченных.

Проверено 2026-10-18 сессией S3 на HEAD `76c01cc4` (поверх `origin/master` `7138270e` с видео).

| AC | Вердикт | Доказательство |
|----|---------|----------------|
| AC1 | PASS | Слияния: sections-menu `85fc4be7`, journal-sets `c553c6eb`, points-model `034739ca`, staff-data `ae0c5945`, company-docs `13eb09d5`, inspection-visits `2584b5d3` (координатор); «Что нового» `4c3efeb6`; дизайн-проход `46f8c48d` (конфликт только в `LATEST_NOTES_BUILD_SHA`, оставлена отметка сведения); master с видео `a503ac34` (без конфликтов). |
| AC2 | PASS | Зависимости поставлены `npm@10 ci` по lock master (zod 4.5.4, Remotion; расхождений с lock 0). `prisma validate` OK; `npm run typecheck` 0; `i18n-types --check` OK после перегенерации (разница только CRLF); хук коммита `76c01cc4` — тесты 4262/0; eslint по 253 изменённым файлам — ошибок нет, кроме 8 в сгенерированном `message-contract.d.ts` (те же 8 есть на master); `npm@10 ci --dry-run` по lock — OK. |
| AC3 | PASS | `smoke.mjs` + `smoke-extra.mjs` (руководитель): /dashboard, /settings/users, /settings/areas, /settings/equipment, /journals, /checklists, /settings/organization, /inspection, /journals/perishable_rejection (+ документ), /settings/buildings, /production-control, /more, /settings/subscription, /settings/journals — все 200, без ошибок страницы и консоли, меню раздела на месте (`raw/smoke-results*.json`). Повар: `/mini/today` — `/api/mini/today` 200, задачи загружены (`cook-today2.mjs`, `raw/cook-today.png`). |
| AC4 | PASS | `verify-worktree` integ-sketch — corrupted 0; `scan-corrupt` — corruptModifiedByAgent 0, corruptUntracked 0. |

## Найдено и исправлено
- **zod 4.5.4** (пришёл в master с lock видео; было 4.3.6): с 4.4 ключ, схема которого — `z.union([..., z.undefined()])` с transform, стал обязательным. В `src/lib/inspection-visits.ts` «вернуть запись» без `reason` и JSON без необязательных полей отклонялись. Исправлено на `.string().nullish()` + тест (`76c01cc4`). В коде master такой записи нет (проверено `git grep`), прочие изменения zod 4.4–4.5 (`.merge` с refine, base64/httpUrl/cuid, tuple) в коде master и веток не используются; `z.preprocess` в формах TasksFlow — внутренние схемы `.optional()`, поведение то же.
- **Смоук «Моей компании»** падал на тестовом профиле ЕГРЮЛ демо-организации в `wesetup_integ` (`{inn,address,nameShort,management}` без `okvedsExtra`/`founders`, вписан вручную; код пишет только полный профиль DaData). На проде все 32 профиля полные (запрос `psql`, только чтение). Профиль в локальной базе сохранён в `raw/legal-profile-backup.json` и обнулён — страница открывается.
- **Нестабильные тесты под нагрузкой машины**: проверки PDF в worker (`order-scan-bombs`, `journal-order-scans`, `inspector/[token]/visits`), «огромный мусор не подвешивает разбор». По отдельности проходят 3/3; на хуке при нагрузке — по 1–4 падения в разных тестах. Повтор хука — 0.
- **CRLF**: `message-contract.d.ts` после слияний на Windows помечается устаревшим; `node scripts/i18n-types.mjs` — разница только в переводах строк.
