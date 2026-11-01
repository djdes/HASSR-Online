# Доказательства — point-jset (2026-11-01)

| AC | Статус | Где |
|---|---|---|
| AC1 | PASS | `src/lib/journal-settings-target.ts` (`resolveJournalSettingsTarget`, `journalSettingsWriteTarget`); тест `journal-settings-target.test.ts` — руководство: точка/организация; руководитель точки: своя точка ок, чужая и «вся организация» — 403 |
| AC2 | PASS | `planJournalSetWrite` (`src/lib/point-journals.ts`), запись — `writeJournalSet` в `disabled-journals.ts`; маршруты `settings/journals` PATCH, `[code]/enable`, `sets` POST; 6 новых тестов в `point-journals.test.ts` |
| AC3 | PASS | `settings/journals/page.tsx`, `settings/auto-journals/page.tsx`, `auto-journals` GET, `preview`, `sets` GET, `dish-pool` — `journalSettingsPointId`; счётчик документов и превью — по точке |
| AC4 | PASS | `organizations/auto-journals` PUT (точка — своя автоматика; организация — `applyAutomationFlags` у точек со своей автоматикой), `apply` (документы точки или все; ensure по каждой точке) — тест `applyAutomationFlags` |
| AC5 | PASS | `saveOrgCommission` → `commissionWriteOwner` (свой состав точки), люди `staffAtBuildingWhere`; `brakerage-commission/[code]` GET/PUT, `members` POST (новый человек — на точке), `brakerage-setup`; тест `brakerage-commission-role-persistence` обновлён и зелёный |
| AC6 | PASS | `journal-auto-create.ts`: `resolveDesiredResponsibles({ buildingId })`, `aliveAtPoint` (`worksAtBuilding`); `restoreBrokenChainForTemplate` — нет своих/общих документов → `no-previous-document`; `ensureCurrentDocumentsForBrokenChains({ skipCodesByBuilding })`, крон `auto-create-journals` передаёт свой набор каждой точки. Тесты: `journal-auto-create-point-people.test.ts`, новые кейсы в `restore-chain` и `broken-chains` |
| AC7 | PASS | `tsc-locked.cjs` → `exit=0 errors=0`; тесты ниже |

## Команды
- `node --import tsx --test src/lib/point-journals.test.ts src/lib/journal-settings-target.test.ts` — 14/14
- `node --import tsx --test src/lib/journal-auto-create-broken-chains.test.ts src/lib/journal-auto-create-restore-chain.test.ts src/lib/journal-auto-create-period-closed.test.ts src/lib/journal-auto-create-point-people.test.ts` — 18/18
- `node --import tsx --test src/lib/brakerage-commission-role-persistence.test.ts` — 1/1
- связанные (`building-settings`, `crumb-menu`, `dish-pool-code`, `journal-controls`, `journal-responsibles-org.smoke`, `master-directory-access`, `point-scope`, `settings-cards`, `app-nav`, `finished-product-dialogs`, `preplan-horizon`, `blank-download`, `custom-names`) — зелёные (232 теста в общем прогоне, единственное падение было в commission-тесте до обновления мока)
- `npx eslint <изменённые файлы>` — без замечаний
- `npm run typecheck` (через очередь) — 0 ошибок

Живой прогон на e2e-БД не делался (по правилам группы — без dev-сервера).
