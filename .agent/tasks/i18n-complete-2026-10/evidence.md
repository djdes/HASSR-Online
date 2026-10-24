# Evidence (2026-10-24)

| AC | Статус | Проверка |
|----|--------|----------|
| AC1 | PASS | Волна 2: 258 файлов кабинета; `scan.ts` по областям — остались только хранимые значения, алиасы импорта, русские константы из `src/lib` (перечислены в отчёте). `npm run typecheck` — 0 ошибок. |
| AC2 | PASS | `npm run i18n:check` — 95/95; `catalog-validation.test.ts` — аргументы ICU совпадают. |
| AC3 | PASS | `src/app/api/translations/auto/route.ts`: ключи с ручной правкой в целевой локали пропускаются (`skipped`) без `overwriteManual`; UI пачкой их не отправляет. |
| AC4 | PASS | `TranslationOverride.sourceRu`; `stale` в API/UI (`isStaleOverride`), тест. |
| AC5 | PASS | `selectSafeOverrides` в `overrides.server.ts`, тест. |
| AC6 | PASS | Категории по журналам (`journal-<code>`, заголовок из каталога); тесты `translations.test.ts` — 12/12. |
| AC7 | PASS | `npm run test:gate` — 4721 pass, 0 fail; typecheck 0 ошибок; eslint по изменённым файлам — новых ошибок нет (13 + 2 уже на master). |

Не проверено: сквозной прогон на БД (локальной БД нет), визуальная проверка страниц.
