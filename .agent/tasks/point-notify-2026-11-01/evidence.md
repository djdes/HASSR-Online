# Evidence — уведомления по точкам (2026-11-01)

Ветка `fix/point-notify` от `origin/master` 1a92d768.

| AC | Где | Статус |
|---|---|---|
| AC1 | `src/lib/core-journal-keepers.ts` — ведущие и запасной список через `filterRecipientsByPlace(org, users, documentPointId)` | PASS (код) |
| AC2 | `src/app/api/cron/expiry/route.ts` — `groupByPoint` + `liveEventPoint`, `notifyOrganization(..., { buildingId })`, письма через `filterRecipientsByPlace`; продукты — цех записи / цех оборудования, документы — `placeBuildingOfUser` | PASS (код) |
| AC3 | `src/app/api/cron/tasksflow-escalations/route.ts` — кандидаты L1 через `filterRecipientsByPlace` с `placeOfEvent({documentId, userId})` | PASS (код) |
| AC4 | `src/app/api/cron/uv-lamp-running/route.ts`, `src/lib/uv-lamp-runs.ts` `lampRecipients` | PASS (код) |
| AC5 | `src/app/api/cron/weekly-digest/route.ts` (сводки точек и без офиса, сводка компании `onlyPlace`), `src/lib/weekly-digest/build.ts` `weeklyDigestRecipients(..., onlyPlace=true)` | PASS (код + тест правила) |
| AC6 | `src/lib/auth.ts` (`placeOfEvent({userId})`), `src/lib/staff-create.ts` (по каждой точке сотрудника, по очереди) | PASS (код) |
| AC7 | `src/lib/today-compliance.ts`, `src/app/api/cron/auto-close-shifts/route.ts` — `journalEntryPointWhere` | PASS (код) |
| AC8 | `src/app/api/cron/journal-automation/route.ts` — `users` по `worksAtBuilding`, сводка по точкам | PASS (код) |
| AC9 | `anomaly-detect`, `predict-alerts`, `weekly-ai-digest` — `{ onlyPlace: true }` | PASS (код + тест правила) |
| AC10 | `src/app/api/cron/general-cleaning-tasks/route.ts` — `getDisabledJournalCodes(org, doc.buildingId)` | PASS (код) |
| AC11 | `src/lib/building-scope.ts` `receivesPlaceEvent` + `building-scope.test.ts` | PASS (тест) |
| AC12 | typecheck и тесты | PASS |

## Команды

```
node --import tsx --test src/lib/point-notify.test.ts src/lib/building-scope.test.ts \
  src/lib/bell-push-once.test.ts src/lib/building-settings.test.ts src/lib/journal-automation.test.ts \
  src/lib/journal-automation-staff.test.ts src/lib/journal-controls.test.ts \
  src/lib/notification-descriptor-producers.test.ts src/lib/org-day-key.test.ts \
  src/lib/staff-create-seat-limit.test.ts src/lib/today-compliance-close-day.test.ts \
  src/lib/today-compliance.test.ts src/lib/credentials-phone.test.ts \
  src/lib/brakerage-commission-role-persistence.test.ts src/lib/ai-assistant/localization.test.ts \
  src/lib/equipment-fill-api-localization.test.ts src/lib/equipment-fill-page-localization.test.ts \
  src/lib/navigation-localization.test.ts src/app/api/cron/mini-digest/route.test.ts \
  src/app/api/cron/checklist-reminders/route.test.ts
→ tests 121, pass 121, fail 0

npm run typecheck (через очередь tsc-locked)
→ exit=0 errors=0
```

## Пропущено

- Аудит #20 (`weekly-digest/build.ts`, сотрудники точки через `staffAtBuildingWhere`): не делаю — сотрудники «на всех точках» числились бы «не отметившимися» в сводке каждой точки.
- Живой прогон кронов на e2e-базе не делался (без dev-сервера по условиям группы); проверено тестами правила и типами.
