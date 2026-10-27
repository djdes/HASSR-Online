# Задача 3. Спецрежим наоборот — evidence

Ветка `feat/special-mode-inverse` (от `origin/master` 8038a1ad), рабочее дерево `D:\wt\special-mode`.

## Модель

`org-journal-controls:<orgId>` (PlatformSetting, JSON):

```
{ automation: { enabled, autoFill, autoCreate, copyYesterday, closeDayAutofill },
  sensorCamera: {...}, brakerageSetup: {...} }
```

Функция работает, если `automation.enabled && automation.<feature>` (`automationOn`,
`src/lib/journal-controls.ts`). Старое `specialMode` в запись больше не попадает
(parseJournalControls его не знает) и читается только правилом ниже.

### Правило для организаций без сохранённого `automation`

`resolveLegacyAutomation` (чистая функция, тесты) + `legacyAutomation` в
`journal-controls.server.ts`:

1. В настройке лежит прежнее `specialMode: true` (всё было скрыто) → **выключено**.
2. Организация создана раньше `SPECIAL_MODE_INVERSION_CUTOFF = 2026-10-28T00:00:00+03:00`
   **и** пользуется автоматикой → **включено всё** (enabled + 4 галочки).
   «Пользуется»: в `Organization.journalAutomationJson` есть журнал с
   `autoCreate` или `autoFill`, или непустой `autoJournalCodes`; то же у любой
   точки (`Building.journalAutomationJson / autoJournalCodes`); или есть активный
   документ с `autoFill = true`.
3. Иначе → **выключено**.

Решение записывается при первом чтении (`getJournalControls` → `updateJournalControls(org, {})`
под advisory-lock): «пользовалась автоматикой» фиксируется на момент выкладки
и не переключается само (например, когда закроется документ с автозаполнением).
Патчи камеры/комиссии без `automation` тоже сначала разрешают правило — не
затирают его «выключено». Нет организации — ничего не пишется, ответ «выключено».

Клиент (`JournalControlsProvider`) до ответа сервера считает всё выключенным
(fail-closed); GET отдаёт уже разрешённое значение.

## AC

| AC | Статус | Проверка |
|----|--------|----------|
| AC3.1 хранение + правило | PASS | `src/lib/journal-controls.test.ts` (fail-closed, галочки, legacy, граница даты); e2e-база: `e2e/task3-controls-runtime.ts` → `e2e/task3-controls-runtime.out.txt` — 5 случаев правила + «явный выбор побеждает» = PASS |
| AC3.2 каждое место — своя галочка | PASS | тест «every automation entry point checks its own box» (33 места); `grep "\.specialMode"` по `src` — пусто |
| AC3.3 окно с галочками / ConfirmDialog | PASS (по коду) | `inspection-special-mode-card.tsx`; тест в `inspection-pages.test.ts`. В браузере не прогонялось (см. ниже) |
| AC3.4 новые организации без автоматики гигиены | PASS | `AUTOMATION_DEFAULT_ON_CODES = []`, `defaultJournalAutomationJson() = {}`; тест в `journal-automation.test.ts` переписан намеренно |
| AC3.5 тексты ru/en/uz | PASS | `inspectionDay.special.*`, `inspectionDay.pages.special.*`, `inspectionDay.guide.step5*`, `inspectionDay.now.specialLead`, `settingsManagement.organizationProfile.specialMode.{description,movedBody}`; `npm run i18n:types` |

### Куда смотрит каждая галочка

- **autoFill** — POST `/api/journal-documents` (autoFill:true), PATCH `[id]` (включение autoFill),
  `[id]/cleaning|climate|cold-equipment|uv-runtime` (apply_auto_fill), `[id]/staff` (дозаполнение
  новых строк), `auto-journals/apply`, `cron/auto-fill-journals`, заполнение в `cron/journal-automation`;
  UI: тумблер `StaffJournalToolbar`, полосы автозаполнения уборки/климата/холодильников/УФ,
  полоса `JournalDocumentShell` (стекло и др.), тумблер чек-листа проветривания, ряд «Заполнять»
  в `JournalAutoCreateToggle`, колонка автозаполнения на `/settings/auto-journals`.
- **autoCreate** — `/api/journal-documents/auto-create`, `cron/auto-create-journals`,
  `cron/journal-automation` (без автосоздания прогон не идёт; заполнение существующих
  документов — за `cron/auto-fill-journals`), создание документа в `auto-journals/apply`;
  UI: ряд «Создавать» в `JournalAutoCreateToggle`, карточка и страница `/settings/auto-journals`
  (`requiresAutomation: "autoCreate"`, без галочки — редирект на `/inspection/special-mode`).
- **PUT `/api/organizations/auto-journals`**: включать (false→true) autoCreate/autoFill — только
  при своей галочке; выключать — всегда.
- **preview** — хватит любой из autoCreate/autoFill (окно служит обоим тумблерам).
- **copyYesterday** — `[id]/copy-yesterday`; кнопка и пункт меню «⋯».
- **closeDayAutofill** — `/api/dashboard/close-day`; «Автозаполнить» на главной и «Закрыть день»
  в палитре команд (Ctrl+K).
- **Фото датчиков** — отвязано: `sensorCameraEnabled` смотрит только на `sensorCamera`,
  `SensorCameraSetting` показывается всегда.

Ответ сервера: 403 `{ code: "special_mode", feature, error: "Функция «…» выключена. Включить её: «Пришла проверка» → «Спецрежим»." }`.

### Окно включения

Галочки по умолчанию: прежний выбор, если хоть одна галочка была сохранена;
впервые — отмечены все четыре (спецрежим включают ради автоматики; лишнее снимают).
«Включить» неактивна без галочек (подсказка «Отметьте хотя бы один пункт»).
Когда включён — пилюли выбранного и «Изменить» (то же окно, кнопка «Сохранить»).
Выключение — `ConfirmDialog` (warn) с перечнем пропадающего; выбор галочек
сохраняется (`enabled: false`), настройки журналов не трогаются.

## Команды

- `npm run typecheck` — единственная ошибка `src/lib/brand-qr-decode.test.ts: Cannot find module 'jsqr'` (чужой файл master, в общем node_modules нет пакета).
- `node --import tsx --test src/lib/journal-controls.test.ts src/components/inspection/inspection-pages.test.ts src/lib/journal-automation.test.ts src/lib/app-nav.test.ts` — 78/78.
- eslint по изменённым файлам — 1 error в `cleaning-document-client.tsx:3927` (`<a>` на `/settings/buildings/`, было до правки), остальное — старые warnings.
- `npm run i18n:check` — падает на `confirm/ru is stale` (CRLF в рабочем дереве Windows, известно); `node --import tsx --test src/i18n/*.test.ts` — 94/95, падает только известный «message argument types are generated».
- `npm run test:gate` — см. отчёт координатору.

## Не сделано / ограничения

- UI в браузере не прогонялся: общий Prisma Client сгенерирован по схеме другой ветки
  (`Organization.qrBrandFrame`), e2e-база её не знает — страницы кабинета на ней падают.
  Проверка на e2e-базе сделана скриптом через серверные функции.
- `/dashboard/catch-up` («Догнать пропуски») в спецрежим не входил и не входит.
- `whats-new-notes.ts` не трогал (делает координатор).
