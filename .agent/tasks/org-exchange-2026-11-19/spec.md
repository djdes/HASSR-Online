# Spec (frozen 2026-11-19): обмен справочниками между своими организациями — связь через мастер-кабинет и разовый перенос

Часть 2 из трёх (дизайн: docs/superpowers/specs/2026-11-19-multi-org-trial-sync-design.md).

Запрос владельца: при создании ещё одной организации «на шаге 2 сверху в окне строчкой» предложить «синхронизацию
через мастер кабинет товаров, сотрудников, объекты, оборудование через чекбоксы с другими соседними в рамках
аккаунта организаций … а так же или разовый импорт точечный». Ответ на уточнение: «связь в обе стороны через
мастеркабинет, с возможностью выбора конкретно чем обмениваться. А так же с возможность разового переноса».

## Исходное состояние
- Окно настройки `CompleteProfileNudge` (анкета → объекты → сотрудники → оборудование) открывается только пока у
  человека нет телефона или организация называется «Моя организация» (`layout.tsx`, `needsProfileCompletion`). У
  организации, созданной через «Новая организация», вместо него плашка `WelcomeOrgBanner` (`?welcome-org=1`).
- Мастер-кабинет (`Organization.kind="directory"`) связывает меню, сырьё, бракераж. Сотрудники, объекты,
  оборудование, справочник продукции (`Product`) между организациями не связываются и не копируются.
- Создание сегодня: сотрудник — `createStaffMember` (`src/lib/staff-create.ts`, лимит мест, доступ к журналам,
  уведомления); должность — `POST /api/positions` (unique organizationId+categoryKey+name); объект —
  `POST /api/settings/buildings` (unique organizationId+name, `checkPointsForCreation`); помещение —
  `POST /api/settings/rooms` (+ `ensureRoomMirrorArea`); цех — `POST /api/areas`; оборудование — `POST /api/equipment`
  (нужен areaId); продукт — `POST /api/products` (дубль по имени без регистра).
- Общего cron-реестра в репозитории нет; ежедневный `GET /api/cron/auto-create-journals` (04:00 МСК) уже вызывается.

## Решения
- Р1. Четыре списка: `products` (Product), `staff` (должности категории staff + линейные сотрудники), `objects`
  (объекты без офиса + помещения), `equipment` (цеха + оборудование).
- Р2. Связь — через мастер-кабинет аккаунта: `DirectoryExchangeMember(masterOrganizationId, organizationId, kinds[])`.
  Кабинета нет — создаётся (`createAccountMasterCabinet`, имя «Мастер-кабинет»). Список `products` дополнительно
  подключает организацию к кабинету как объект (меню, сырьё, бракераж) — best-effort, отказ кабинета не ломает обмен.
- Р3. Обмен в обе стороны между всеми участниками кабинета, у кого отмечен этот список. Соответствие записей —
  `DirectoryExchangeLink(masterOrganizationId, entity, groupId, organizationId, entityId?, hash)`. Запись без связи
  сопоставляется по естественному ключу (имя без регистра и пробелов + вид/тип + родитель), иначе создаётся у остальных.
  Изменили в одной — обновится в остальных; изменили в нескольких — побеждает более поздняя правка (`updatedAt`; у цехов
  и оборудования его нет — первая по порядку участников). Удаление не переносится: у удалившего запись заново не
  создаётся (связь с `entityId = null`), у остальных остаётся.
- Р4. Никогда не переносим: руководителей и людей с входом (роль management, непустой `passwordHash`), ROOT, комиссию,
  почту, пароль, Telegram, привязку датчиков (`tuyaDeviceId`), ответственных в помещениях и оборудовании, офис.
- Р5. Лимиты тарифа действуют: сотрудник — через `createStaffMember` (места), объект — `checkPointsForCreation`.
  Не поместилось — пропускается и попадает в итог («не добавлено из-за тарифа: N»). Закрытая организация (часть 1) в
  обмене не участвует.
- Р6. Разовый перенос: из выбранной организации аккаунта в текущую, по спискам и по отдельным позициям; дубли по
  естественному ключу пропускаются; связь не сохраняется. Родители подтягиваются сами (цех оборудования, объект
  помещения, должность сотрудника).
- Р7. Настраивает владелец аккаунта, и только между организациями своего аккаунта.
- Р8. Обмен запускается при сохранении настроек, кнопкой «Синхронизировать сейчас» и раз в сутки (шаг в
  `auto-create-journals`, best-effort). Один обмен на кабинет одновременно (advisory lock).
- Р9. Окно настройки у новой организации аккаунта: после «Создать и перейти» (`?welcome-org=1`) открывается тот же
  мастер из 4 шагов; шаг 1 — короткая анкета организации (название, сфера, форма собственности, ИНН, число объектов;
  телефон и имя берутся из профиля, пароль не спрашиваем). Строка-предложение — первой в шаге «Объекты».

## Устройство (контракты для реализации)

### Схема (`prisma/schema.prisma`, только добавление)
```prisma
model DirectoryExchangeMember {
  id                   String       @id @default(cuid())
  masterOrganizationId String
  masterOrganization   Organization @relation("DirectoryExchangeMaster", fields: [masterOrganizationId], references: [id], onDelete: Cascade)
  organizationId       String
  organization         Organization @relation("DirectoryExchangeMember", fields: [organizationId], references: [id], onDelete: Cascade)
  kinds                String[]     @default([])   // products | staff | objects | equipment
  createdByUserId      String?
  lastSyncedAt         DateTime?
  lastSyncJson         Json?
  createdAt            DateTime     @default(now())
  updatedAt            DateTime     @updatedAt
  @@unique([masterOrganizationId, organizationId])
  @@index([organizationId])
}
model DirectoryExchangeLink {
  id                   String       @id @default(cuid())
  masterOrganizationId String
  masterOrganization   Organization @relation("DirectoryExchangeLinkMaster", fields: [masterOrganizationId], references: [id], onDelete: Cascade)
  entity               String       // product | position | staff | building | room | area | equipment
  groupId              String
  organizationId       String
  entityId             String?      // null — запись в этой организации удалили: заново не создаём
  hash                 String
  createdAt            DateTime     @default(now())
  updatedAt            DateTime     @updatedAt
  @@unique([masterOrganizationId, entity, groupId, organizationId])
  @@index([masterOrganizationId, entity, organizationId])
}
```

### Библиотека `src/lib/directory-exchange/`
- `kinds.ts` (чистый): `EXCHANGE_KINDS = ["products","staff","objects","equipment"]`; сущности по спискам и порядок
  зависимостей `position → staff`, `building → room`, `area → equipment`, `product`; естественные ключи; переносимые
  поля; `hashFields(fields)`.
  - product: ключ `kind|имя`; поля name, supplier, barcode, unit, category, kind, storageTemp, storageConditions,
    shelfLifeDays, shelfLifeHours, servingTemp. Только `isActive`.
  - position: только `categoryKey = "staff"`; ключ `имя`; поля name.
  - staff: `ORG_ROSTER_WHERE`, роль не management, `passwordHash = ""`, должность категории staff; ключ `имя`; поля
    name, phone, weeklyDaysOff; родитель — группа должности.
  - building: `kind != "office"`; ключ `имя`; поля name, address.
  - room: ключ `группа объекта|имя`; поля name, kind, sortOrder; родитель — группа объекта.
  - area: ключ `группа объекта или "-"|имя`; поля name, description; родитель — группа объекта (если объект обменивается),
    иначе единственный объект организации, иначе без объекта.
  - equipment: ключ `группа цеха|type|имя`; поля name, type, serialNumber, tempMin, tempMax, lampModel,
    lampLifetimeHours; родитель — группа цеха.
  Имя в ключе — `trim`, свёртка пробелов, нижний регистр.
- `plan.ts` (чистый): `planEntityExchange({ participants, rows, links, newGroupId }) → ExchangeOp[]`, операции
  `link | create | update | tombstone | rehash`. Правила Р3.
- `entities.server.ts`: загрузка строк организации и применение операций по каждой сущности через существующие правила
  создания (Р4, Р5); отказ тарифа или конфликт уникальности — пропуск со счётчиком, не ошибка всего обмена.
- `run.server.ts`: `runDirectoryExchange(masterOrganizationId, { actor?, now? })`, `runAllDirectoryExchanges()`,
  `transferPreview({ fromOrganizationId, toOrganizationId })`, `transferOnce({ fromOrganizationId, toOrganizationId,
  selection, actor })`. Advisory lock на кабинет.
- `settings.server.ts`: `loadExchangeState(userId, organizationId)`, `saveExchangeMembers({ ownerUserId,
  organizationId, members })`, `ensureExchangeCabinet(ownerUserId, accountId)`.

Итог обмена: `ExchangeSummary = { organizations: Array<{ organizationId, name, kinds: Record<kind, { created, updated,
skippedLimit, skippedConflict }> }>, notes: string[] }`.

### API (`src/app/api/settings/directory-exchange/`)
- `GET /` → `{ canManage, organization: {id,name}, counts: Record<kind, number>, siblings: Array<{ id, name, counts }>,
  cabinet: {id,name}|null, members: Array<{ organizationId, name, kinds, lastSyncedAt }>, lastSync: ExchangeSummary|null }`.
  `canManage` — владелец аккаунта активной организации с полным доступом, не «войти как».
- `PUT / { members: Array<{ organizationId, kinds }> }` → сохраняет участников (пустые `kinds` — выход из обмена),
  создаёт кабинет при необходимости, запускает обмен → `{ ok: true, summary }`.
- `POST /sync` → `{ ok: true, summary }`.
- `GET /transfer?from=<organizationId>` → `{ items: Record<kind, Array<{ id, name, detail: string|null, exists: boolean }>> }`.
- `POST /transfer { fromOrganizationId, selection: Partial<Record<kind, string[] | "all">> }` → `{ ok: true, summary }`.
Все — 403 не владельцу, 404 на организацию не из своего аккаунта, 409 при закрытой организации, rate limit.

### Интерфейс
- Тексты — `dashboardUi.directoryExchange.*` (ru/en/uz).
- `src/components/directory-exchange/exchange-dialog.tsx` — окно «Связать или перенести данные»;
  `exchange-offer-line.tsx` — строка первой в `SetupPointsStep`; `exchange-card.tsx` — карточка на
  `/settings/master-cabinet`.
- Мастер новой организации: при `?welcome-org=1` владельцу открывается `CompleteProfileModal` в режиме организации
  (шаг 1 — название, сфера, форма собственности, ИНН, число объектов; телефон и имя берутся из профиля, пароль не
  спрашивается), дальше шаги 2–4 как у первой регистрации. `WelcomeOrgBanner` остаётся под окном.

## Критерии приёмки
- AC1. Планировщик обмена — чистая функция с тестами: сопоставление по ключу, новая запись → создать у остальных,
  правка в одной → обновить у остальных, правка в двух → поздняя побеждает, удаление → не воссоздаётся и не удаляется
  у других, повторный запуск без изменений → пустой план.
- AC2. Схема: две новые таблицы, `prisma db push` без потери данных.
- AC3. Обмен исполняется по всем четырём спискам с зависимостями (должность → сотрудник; объект → помещение; цех →
  оборудование), соблюдает Р4 и Р5, пишет итог в `lastSyncJson` и аудит.
- AC4. API `/api/settings/directory-exchange` (GET состояние, PUT настройка + обмен, POST sync, GET transfer-preview,
  POST transfer): только владелец аккаунта, только свои организации (чужой id → 403/404), rate limit.
- AC5. Новая организация аккаунта получает мастер из 4 шагов; на шаге «Объекты» сверху строка с предложением, если в
  аккаунте есть другие организации; окно «Связать или перенести» — галочки списков, выбор организаций, режим; в режиме
  переноса — выбор позиций.
- AC6. «Настройки → Мастер-кабинет»: карточка «Обмен справочниками» — участники, списки, время и итог последнего
  обмена, «Синхронизировать сейчас», «Перенести один раз».
- AC7. Ежедневный обмен подключён к `auto-create-journals`; ошибка обмена не ломает задачу.
- AC8. Тексты ru/en/uz, типы перегенерированы, палитра нового дизайна актуальна.
- AC9. typecheck, test:gate, i18n:check; живой прогон: две организации аккаунта → связь всех четырёх списков →
  данные первой появились во второй → правка и новая запись во второй появились в первой → удаление не вернулось;
  разовый перенос выбранных позиций; лимит мест даёт пропуск с понятным итогом; чужая организация → отказ.

## Уточнения после независимой проверки (2026-11-19, до выпуска)

- **К Р3 (цеха).** Объект цеха в отпечаток не входит и обменом не меняется: когда «Объекты» включают позже
  «Оборудования», цеха остаются на своих объектах со своими описаниями (иначе цеха одной организации переезжали
  на объекты другой).
- **К Р4 и Р6 (дубли).** Перед созданием сотрудника проверяется любое совпадение ФИО в организации — с входом,
  руководитель, в архиве; перед созданием продукта — и выключенные продукты. Совпало — запись пропускается как дубль,
  а в предпросмотре переноса показана уже существующей.
- **К Р3 (телефон).** Телефон сравнивается в едином виде; пустой телефон образца номер у получателя не стирает.
- **К Р3 (кто побеждает).** У сотрудников, цехов и оборудования нет времени правки: при правке одной записи в двух
  организациях между обменами берётся правка первого по порядку участника.
- **К Р8.** Организации на паузе и отменённые в обмене не участвуют.
- **К AC5 (окно).** Обмен общий для всех участников кабинета — это написано в окне: организация, у которой список
  уже включён, получает его и без галочки; убрать организацию из обмена — в её окне, «Отключить обмен». Enter в
  поиске позиций перенос не запускает.
- **К Р9.** Мастер открывается только у организации из адреса (`?welcome-org=<id>`); после закрытия не открывается
  заново до конца вкладки, плашка «Новая организация» остаётся под ним.
