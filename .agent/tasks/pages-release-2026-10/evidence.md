# Evidence — сведение и выкладка страниц разделов (S4, 20.10.2026)

Ветка `feat/pages-release`, рабочая копия `D:\wt\pages-release`, база `wesetup_pages_release`
(копия `wesetup_integ`), dev-сервер :3077.

## Состав
От `origin/master` `ca822e39`, затем свежий master `66ca984e`:

| Раздел | Ветка, коммит | Evidence |
|---|---|---|
| Торговые точки | `feat/pages-points` `3fc80bd5` | `.agent/tasks/pages-points-2026-10/` — AC1–AC6 PASS |
| Сотрудники | `feat/pages-staff` `2b976b16` | `.agent/tasks/pages-staff-2026-10/` — AC1–AC9 PASS |
| Моя компания | `feat/pages-company` `195ae23e` | `.agent/tasks/pages-company-2026-10/` — AC1–AC6 PASS |
| Журналы (наборы) | `feat/pages-journals` `62eac579` | `.agent/tasks/pages-journals-2026-10/` — AC1–AC4 PASS |
| Пришла проверка | `feat/pages-inspection` `2313c779` | `.agent/tasks/pages-inspection-2026-10/` — AC1–AC7 PASS |
| Чек-листы | `feat/pages-checklists` `c6be953b` | `.agent/tasks/pages-checklists-2026-10/` — AC1–AC7 PASS |

## Конфликты сведения
- `src/lib/app-nav.ts` — подписи групп меню: объединены (`groups`, `sets`, `myPoints`, `allPoints`).
- `src/lib/app-nav.test.ts` — ожидаемые меню разделов и проверки по ролям: сохранены проверки всех веток.
- `src/lib/navigation-localization.test.ts` — счётчик маршрутов: 123 + 6 (сотрудники) + 3 (компания) + 3 (журналы) + 4 (проверка) + 3 (чек-листы) = 142.
- `src/i18n/messages/{ru,en,uz}.json` — новые блоки разных разделов в одном месте: текстовый стык,
  проверенный трёхсторонним слиянием по ключам (скрипты `C:\Users\Two\wesetup-backup-2026-10-17\pages-specs\json3merge.cjs`,
  `json-concat-resolve.cjs`); `message-contract.d.ts` пересобран `node scripts/i18n-types.mjs`.

## Проверки
- Pre-commit hook на каждом слиянии с конфликтом (секреты, tsc, тесты против baseline, `TEST_CONCURRENCY=6`): 4284/0, 4296/0, последний — зелёный.
- Тесты меню и соседние после каждого слияния — зелёные (последний прогон 74/74 с тестами чек-листов).
- Схема: `node scripts/apply-safe-schema.cjs --dry-run` на базе со схемой master — 8 только добавляющих инструкций
  (`ChecklistAssignment`, 4 колонки `ChecklistInspection`, индексы, связи) → `raw/schema-review.sql`; применение — «Additive schema changes committed»; повтор — 0.
- Смоук `smoke.mjs` (`raw/smoke-run-2.txt`, `raw/smoke-results.json`): 25 новых адресов шести разделов —
  руководитель 1440: 25/25 открылись с заголовком; Mini App 390: 25/25 без горизонтальной прокрутки;
  заведующая — уводится только с «Моей компании» и «Назначения» (их guard — `admin.full`);
  повар — уводится со всего, кроме чек-листов (у демо-повара есть доступ к чек-листам). Проблем: 0.
- `verify-worktree` → `corrupted: 0`; `scan-corrupt` → `corruptModifiedByAgent: 0`, `corruptUntracked: 0`.

## После выкладки
- Строка crontab для `/api/cron/checklist-reminders` (ежечасно, по образцу соседних строк).
- Проверка прода: `.build-sha`, PM2, HTTP новых адресов.
