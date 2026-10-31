# Доказательства — ответственные за журналы по точкам (2026-10-31)

| AC | Статус | Где |
|---|---|---|
| AC1 | PASS | `prisma/schema.prisma`: `Building.journalResponsibleUsersJson Json?`; e2e-база — `prisma db push` |
| AC2 | PASS | `src/lib/journal-responsibles-points.ts`; `journal-responsibles-points.test.ts` (6 тестов) |
| AC3 | PASS | `journal-responsibles-cascade.ts`: `cascadeResponsibleToActiveDocuments` (сохранение в точку или организацию) + `applyResponsiblesToDocuments` (по документу — действующие ответственные его точки, авто-подбор из людей точки) + `resetPointResponsibles`; `prefillResponsiblesForNewDocument` — слоты и ростер точки. e2e `raw/check.txt`: организация → Борис (точка Б) — документ Б = Борис, документ А ≠ Борис; новый документ А/Б — Анна/Борис; организация → Вера — точка А со своими остаётся Анна |
| AC4 | PASS | `api/settings/journal-responsibles/[code]/route.ts` (PUT с `buildingId`, DELETE); `point-scope.ts` + тест (страница и `/<code>` открыты, `resync-all`/`apply-presets`/`recreate-documents`/`backfill-verifiers` — 403); e2e: сотрудник точки Б в ответственные точки А — 400 |
| AC5 | PASS | `settings/journal-responsibles/page.tsx` (`getViewedPointId`, `pickableUsers`, `ownForPoint`), `journal-responsibles-client.tsx` (баннер, «Своё для точки» / «Как у организации», «Вернуть как у организации» через `confirmAsync`, должности только просмотр, общие кнопки скрыты); ru/en/uz + `message-contract.d.ts`; e2e: страница 200, баннер «Ответственные точки «Точка А»», в свойстве `users` — Анна, нет Бориса |
| AC6 | PASS | `core-journal-keepers.ts`, `uv-lamp-runs.ts`, `cron/uv-lamp-running`, `temperature-deviations.ts`, `bulk-assign-today` (one-per-filler), `api/journal-documents` (POST), `journal-auto-create.ts`, `journal-rolling.ts`, `journals/[code]/page.tsx`, `settings/brakerage-setup`, `journal-responsible-person.ts` — через `effectiveJournalSlots`; `tasksflow-verifier-cascade.ts` — `buildingId` (точка / только общие) |
| AC7 | PASS | `staff/[id]/archive` → `removeUserFromPointResponsibles`; `account/delete` — в транзакции `withoutUser` по точкам |
| AC8 | PASS | `npm run typecheck` — exit 0, 0 ошибок; `npm run i18n:check` — 97/97 (после `i18n:types`; на Windows-копии с CRLF генератор иначе считает confirm/errors «устаревшими» только из-за переводов строк); тесты 123/123; `raw/check.txt` ALL PASS (20); `verify-worktree` — 0 повреждённых |

## Проверки

- Тесты: `journal-responsibles-points`, `point-scope`, `settings-cards`, `app-nav`,
  `journal-responsibles-doc-patchers`, `temperature-deviations`, тесты QR
  (equipment-fill, room-fill, journal-qr-first-document,
  notification-descriptor-producers) — 123/123.
- eslint изменённых файлов: новых ошибок нет (3 давние `no-html-link-for-pages`
  в `journals/[code]/page.tsx` и `journal-responsibles-client.tsx`, давние
  предупреждения о неиспользуемых импортах).
- e2e-база (не прод), dev на 3023 (`--webpack`): `raw/check.ts` → `raw/check.txt`.

## Замечания

- Руководитель точки с офисом (`pointScope`) проверен юнит-тестами proxy и
  кодом маршрута; на e2e-организации офиса нет, поэтому там заведующая точки —
  руководитель, привязанный к точке (смотрит свою точку, правит её).
- В HTML страницы на dev-сервере есть отладочная запись React с результатом
  запроса сотрудников (всех) — в прод-сборке её нет; проверка смотрит свойство
  `users` клиентского компонента.
- «Баланс нагрузки», «Соответствие», список проверяющих и ППК считают по карте
  организации (сводки на всю компанию).
