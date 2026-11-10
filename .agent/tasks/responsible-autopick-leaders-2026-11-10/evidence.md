# Evidence: автоподбор ответственного — только руководящая должность (2026-11-10)

Проверено на ветке `claude/affectionate-newton-7hw7ae` (база master dbb2f17a).

| AC | Итог | Чем подтверждено |
|----|------|------------------|
| AC1 Ответственный и проверяющий — руководящая должность | PASS | `pickRosterForUnsetSlot`, `leadershipTier` (`src/lib/journal-roster.ts`); тесты `journal-roster.test.ts`; прогон настоящего `prefillResponsiblesForNewDocument` на локальной БД — `raw/prefill-db-run.txt`: только рядовые → «—»; появился старший повар → он; появилась заведующая → она. |
| AC2 Прочие слоты — только должность слота | PASS | тест «прочие слоты исполнителей: только должность слота, иначе никто». |
| AC3 Свои люди точки первыми | PASS | `pointStaffFirst` в `loadSlotRoster`; `journal-responsibles-point-first.test.ts`. |
| AC4 Не задето остальное | PASS | `rankRosterForSlot` не менялся; его прежние тесты и тесты привязки сотрудников проходят (`raw/test-gate.txt`). |
| AC5 Проверки | PASS | `npm run typecheck` — exit 0 (`raw/typecheck.txt`); `npm run test:gate` — exit 0 (`raw/test-gate.txt`); eslint по изменённым файлам — чисто (`raw/eslint.txt`). |

Не проверялось: данные организации из тикета (доступа к прод-базе нет) — причина установлена по коду.

## Дополнение: похожие места (AC6–AC7)

| AC | Итог | Чем подтверждено |
|----|------|------------------|
| AC6 Общий выбор по роли | PASS | `src/lib/user-roles.ts`; `user-roles.test.ts`, `no-arbitrary-default-person.test.ts`; `sensor-point.ts`, `offboarding.ts` — явный `fallbackToFirst`. |
| AC7 Построители журналов | PASS | `cleaning-document.ts`, `acceptance-document.ts`, `metal-impurity-document.ts`, `product-writeoff-document.ts`, `audit-plan-document.ts`, `journals/[code]/page.tsx`, `equipment-cleaning-document-client.tsx`; тесты `no-arbitrary-default-person.test.ts`, `acceptance-document.test.ts`, `acceptance-source.test.ts`. Полный прогон — `raw/test-gate-full.txt`. |

Обновлены три теста, закреплявших прежнее поведение («рядовой первым»): `user-roles.test.ts`,
`acceptance-document.test.ts`, `acceptance-source.test.ts`.
