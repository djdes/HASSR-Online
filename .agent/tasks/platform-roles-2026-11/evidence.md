# Evidence: роли панели — менеджер с закреплёнными клиентами, РОП, коммерческий директор

Ветка `claude/peaceful-brown-tgkspp` от master `e976a11`. Проверка — локальная PostgreSQL 16, `next dev`,
Playwright (владелец, менеджер, коммерческий директор), pdfjs-dist для текста PDF.

**Итог: все AC — PASS.**

| AC | Статус | Доказательство |
|---|---|---|
| AC1 Схема | PASS | `raw/schema-additive.sql`: 6 операций — `PlatformRole`, `User.platformRoleId` (+FK SET NULL), `User.platformTitle`, `Organization.accountManagerId`; `additiveSchemaSql` пропустил |
| AC2 Роли | PASS | `src/lib/platform-roles.test.ts` (11); API `/api/root/team/roles` (только владелец, правило `/api/root/team`). `raw/ui-check.txt`: 9 ролей, создать «Аккаунт-менеджер» → 10, удалить → 9; Мария → «Менеджер по продажам»: в БД `crm,clients,sales`, РОП нет, метка «свои». Изменение роли переписывает разделы и РОП людям (`updatePlatformRole`, транзакция) |
| AC3 Раздел CRM | PASS | `platform-access.ts`: `crm` первым разделом, `/root/crm*` и `/api/root/crm*` — `crm`; `platform-access.test.ts` (обход всех маршрутов) и `crm/rop.test.ts` зелёные; сид добавил `crm` всем 4 с «Продажами» (`raw/seed-platform-roles.txt`); администратор с полным набором остаётся администратором (тест) |
| AC4 Охват «свои» | PASS | `raw/ui-check.txt` под менеджером: список клиентов — 1 (только «Ромашка»), своя карточка 200, чужая 404, чужой лид 404, PATCH чужого лида 404, «Почта и фильтры» 404, «Здоровье» 404, назначить лид другому — 403, менять менеджера клиента — 404; CRM — свои и свободные; «Взять себе» → Дмитрий за Марией. Чистые правила — `scopedTargetOf`, `canAccessPlatformPath` с `allScope` (тесты) |
| AC5 Закрепление клиента | PASS | Карточка «Ромашки» → «Ответственный менеджер» = Мария: тост «Лидов CRM передано: 1», Иван Петров (контакт CRM этой организации) → Мария; новый контакт клиента получает менеджера (`ingest.server.ts`, тест на исходник) |
| AC6 Подпись | PASS | `signaturePosition` — порядок (тест); генератор КП у alexey: «Алексей / Коммерческий директор»; `raw/kp-signature-check.txt`: письмо — да, веб-версия — да, PDF — да. Найдено и исправлено: токен ссылки на PDF/веб-версию терял должность (`token.ts`, тест), письмо и веб-версия её не выводили (`content.ts`, `email.ts`, `kp/[token]/page.tsx`) |
| AC7 Сид | PASS | `raw/seed-platform-roles.txt`: dry-run ничего не пишет; прогон — 9 ролей, `crm` 4 людям, привязка 2 из 4 (Продажи, Коммерческий директор), alexey — роль и должность «Коммерческий директор»; повтор — already done. Шаг деплоя — после сида РОП |
| AC8 Проверки | PASS | `raw/typecheck.txt` EXIT 0; `raw/test-gate.txt` 5882 pass / 0 fail; `raw/i18n-check.txt` 97 pass; eslint по изменённым файлам — EXIT 0 |

## Попутно

- Исправлены два теста-рендера (`root-metrics-localization`, `root-organization-management-localization`):
  чтения менеджера идут через `account-manager.server` (мок в тесте карточки), а не напрямую в БД.
- Сид РОП «БФС»: на проде дважды «никого» — по ИНН и ЕГРЮЛ организаций с реквизитами ООО «БФС» нет.
  Теперь «БФС» — это и организация платформы (ООО «БФС» ведёт WeSetup): владелец и команда панели с
  Telegram; людям без доступа к панели роль не выдаётся. Владелец может включить РОП себе сам:
  «Команда и доступы» → «Подпись и РОП».

## Что меняет деплой

Таблица `PlatformRole`, колонки `User.platformRoleId`, `User.platformTitle`, `Organization.accountManagerId`
(`apply-safe-schema`); сид `prisma/seed-platform-roles-2026-11.ts` (однократный); сид РОП «БФС» с организацией
платформы.
