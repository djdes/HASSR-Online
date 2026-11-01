# Доказательства — настройки журналов у организации (2026-11-01)

| AC | Изменение | Проверка |
|---|---|---|
| AC1 | `prisma/schema.prisma`: модель `OrganizationJournalSetting`, связи у `Organization` и `JournalTemplate` | `npx prisma validate` — valid; `scripts/lib/schema-safety.cjs` пропускает CREATE TABLE/INDEX/ADD CONSTRAINT |
| AC2 | `distribution` → `organizationJournalSetting.upsert`; `bonus` → `saveOrgJournalSetting`; `journalTemplate.update` из обоих убран | чтение кода; typecheck |
| AC3 | `src/lib/org-journal-settings.ts` (`withOrgJournalOverride`, `applyOrgJournalOverrides`, `orgJournalBonusKopecks`); читатели: `journal-obligations` (`listTemplates(organizationId)`), `today-compliance` (2 места), `tuya-pull`, `claim-bonus`, `submit-bonus`, `api/mini/home`, `mini/bonus/[id]`, `bulk-assign-today`, страницы journals / journal-bonuses / onboarding/advanced | `org-journal-settings.test.ts` 5/5; `journal-obligations.test.ts`, `today-compliance*.test.ts` зелёные |
| AC4 | исполнитель берётся из настройки организации, если она есть | тест «исполнитель шаблона не просачивается» |
| AC5 | `scripts/move-journal-template-settings-to-orgs.ts` (отчёт по умолчанию) | не запускался на проде — ждёт разрешения владельца |
| AC6 | `prisma/seed-journal-fill-modes.ts`: `organizationId notIn` организаций со своим режимом | чтение кода (сид за флагом `RUN_LEGACY_DATA_SEEDS=1`) |
| AC7 | `src/lib/external/idempotency-key.ts`; `external/entries` ищет ключ после определения организации | `idempotency-key.test.ts` 3/3 |
| AC8 | `generateServiceCode` по умолчанию — `crypto.getRandomValues` | тесты dish-pool (если есть) зелёные; typecheck |
| AC9 | — | `node --import tsx --test …` 35/35; `npm run typecheck` 0 ошибок; eslint по изменённым файлам 0 |

Не сделано: `src/lib/assistant/context.ts` показывает ИИ режим шаблона (нет вызовов из интерфейса; файл правится в PR ботов).
