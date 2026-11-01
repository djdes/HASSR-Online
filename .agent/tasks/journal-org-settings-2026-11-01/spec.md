# Настройки журналов — свои у каждой организации (2026-11-01)

## Проблема

`PUT /api/settings/journals/<code>/distribution` и `PUT /api/settings/journals/<code>/bonus`
доступны руководителю любой организации и писали `fillMode`, `defaultAssigneeId`,
`bonusAmountKopecks` прямо в `JournalTemplate` — общий шаблон всех организаций
платформы. Правка одного клиента меняла распределение задач и бонусы у всех.

Попутно (проверка «между организациями»):
- `POST /api/external/entries`: ключ повтора = 4 последних символа токена + ключ
  клиента. У общего токена все организации делили одно пространство ключей, у
  токенов организаций хвосты совпадают — чужой сохранённый ответ возвращался, а
  записи второй организации молча не писались.
- `generateServiceCode` (код подключения к базе блюд и мастер-кабинету) брал
  `Math.random`.

## Критерии приёмки

- AC1. Новая модель `OrganizationJournalSetting (organizationId, templateId)` с
  `fillMode?`, `defaultAssigneeId?`, `bonusAmountKopecks?`; null — значение шаблона.
  Аддитивно (deploy применит схему).
- AC2. `distribution` и `bonus` пишут настройку текущей организации; `JournalTemplate`
  не меняют.
- AC3. Все читатели берут значение организации: создание обязательств
  (`journal-obligations` — single/sensor/per-employee и исполнитель), подсчёт
  заполнения (`today-compliance`), датчики (`tuya-pull`), бонусы (`claim-bonus`,
  `submit-bonus`, Mini App главная и экран бонуса, TasksFlow bulk-assign),
  страницы `/settings/journals`, `/settings/journal-bonuses`,
  `/settings/onboarding/advanced`.
- AC4. Исполнитель шаблона (человек одной организации) не действует в организации
  со своей настройкой.
- AC5. Разовый скрипт `scripts/move-journal-template-settings-to-orgs.ts`: по
  умолчанию только отчёт; `--apply` отдаёт исполнителя шаблона его организации;
  `--reset-defaults` возвращает шаблонам дефолты, сохраняя бонус организациям,
  где им пользовались. На проде — только с разрешения владельца.
- AC6. Legacy-сид `seed-journal-fill-modes.ts` (только при `RUN_LEGACY_DATA_SEEDS=1`)
  не удаляет обязательства организаций со своим распределением.
- AC7. Ключ повтора внешнего API = организация + отпечаток полного токена + ключ
  клиента; поиск — после определения организации.
- AC8. `generateServiceCode` — криптостойкий генератор (Web Crypto).
- AC9. Тесты новых правил; typecheck 0 ошибок.
