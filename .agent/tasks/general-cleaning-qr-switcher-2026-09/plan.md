# Plan: general cleaning schedule (A), journal switcher (B), QR button and QR across periods (C–E)

Prepared 2026-09-22 by the planning agent (Opus 5). None of the tasks needs a Prisma schema change.

## Context

- Stack: Next 16, Prisma 7 on a pg pool (`src/lib/db.ts`). Unit tests: `npm test` runs node:test over `src/**/*.test.ts`. Type check: `npm run typecheck`.
- E2E stand: local PG `localhost:5432/wesetup_e2e`, `next dev -p 3020` (a dev server on 3020 is usually already running against wesetup_e2e). DB helper `.agent/tasks/journal-responsibles-org-2026-09/e2e/db.ts` refuses any URL other than the local one. `.env` must never be used (its DATABASE_URL is a tunnel to prod). Playwright: `chromium.launch({ channel: "chrome" })`.
- Rules: П-3 (Mini App is the site inside a shell), П-10/П-12/П-13/П-15/П-19 (tasks go to TasksFlow through the outbox with deterministic keys), the design system (`.claude/skills/design-system/SKILL.md`: indigo, rounded-2xl/3xl, 150–200 ms, `ConfirmDialog`/`confirmAsync`), WhatsNew (main session does it), proof artifacts in `.agent/tasks/<id>/`.

## Findings (file:line)

### A. General cleaning schedule (`general_cleaning`)

Data model (`src/lib/sanitation-day-document.ts`):
- Each row has `plan` and `fact` of type `Record<month, string>` (28–40), free text holding day numbers. `normalizeMonthCell` turns empty into "-" (88–90). `normalizeRows` keeps only `id/roomId/roomName/plan/fact` (113–135), so any new field is dropped on PATCH normalization.
- Stub default config already contains "10, 17, 24" (265): several dates per month exist only as free text.

Date inputs (`src/components/journals/sanitation-day-document-client.tsx`):
- Grid «План» cells: `<Input>` free typing, saved on blur (1333–1347 → `saveMonthValue` 880–898). «Факт» cells same (1364–1378).
- Mobile cards: `CardEditSheet` with 12 text fields (`buildMonthsEditFields` 901–908, sheet 1528–1550).
- Document settings «Дата документа»: native `<Input type="date">` in the v2 modal (463–473) and legacy dialog (611–624).
- Dead code: `RoomDialog` month `<Select>`s (288–326) never render.
- List page create/settings: `DateField` labelled «Дата начала» (wrong) (`sanitation-day-documents-client.tsx:235–250`). Generic create dialog: `DateField` (`create-document-dialog.tsx:850–866`).
- No wheel picker exists. Only `DateField` (typed text + calendar popover) at `src/components/journals/journal-dialog-field.tsx:257–417`.

Room schedule (`prisma/schema.prisma`): `Room.generalDays` bitmask bit0 = Monday (623; `src/lib/weekday-mask.ts`), `generalScheduleType` weekly|monthly (631), `generalMonthDays` like `["1","15","last"]` (635). Edited in `src/components/cleaning/room-editor-dialog.tsx:697–749`; `onSaved` snapshot (90–116, 311–339) ignored by the sanitation client (1498–1502). The only applier is a closure in `applyRoomScheduleToMatrix` (`src/lib/cleaning-document.ts:~2525–2549`), not exported.

TasksFlow adapter (`src/lib/tasksflow-adapters/sanitation-day.ts`): one recurring monthly task per row (66–76, 244–256); calls the TF client directly bypassing the outbox (261, 268); deletes every link whose key is not a row id incl. `fanout:`/`verifier-summary:` (293–310); `applyRemoteCompletion` overwrites the current UTC month fact cell with "✓" (35, 315–337).

TF plumbing: `CreateTaskInput` has no due date (`src/lib/tasksflow-client.ts:45–72`); `Idempotency-Key` supported (141–148). Outbox cron requires numeric `payload.taskId` before looking at the action (`src/app/api/cron/tasksflow-outbox/route.ts:77–92`), no `createTask` action (121–137). Deterministic key precedent `doc-delete::…` (`src/lib/journal-document-tasks-cleanup.ts:62`); date-keyed one-off tasks precedent (`src/lib/cleaning-cell-override-sync.ts:427–461`). `TasksFlowTaskLink` unique `(integrationId, journalDocumentId, rowKey)` (schema 2229). Bulk send creates recurring tasks (`src/app/api/integrations/tasksflow/bulk-assign-today/route.ts:1139–1152`) and fan-out for `general_cleaning` (`src/lib/tasksflow-bulk-assign.ts:59`).

Completion: TF `complete` passes UTC `todayKey` (`src/app/api/integrations/tasksflow/complete/route.ts:119`); QR/task-fill use row-level keys (`src/lib/journal-fill.ts:163–186`).

Other readers: PDF (`src/lib/document-pdf.ts` ~4409–4412, 4478, 4482; call ~7075–7089); copy blanks `fact` (`src/lib/journal-document-copy.ts:175–184`); demo (`src/lib/demo-organization.ts:926–955`); PATCH normalizes (`src/app/api/journal-documents/[id]/route.ts:321–339`), brakerage lock-merge precedent (562–571), TF hook (586). Seeding without schedule fields: `api/journal-documents/route.ts:418–430, 696–712`, `journal-default-configs.ts:96, 205–217`, `journal-responsibles-cascade.ts:79–83`. Helpers: `withDocumentConfigLock` (`src/lib/document-config-lock.ts:25`), live events (`src/lib/journal-change-events.ts`), `TodayKeyProvider`.

### B. Journal switcher

- `src/components/ui/breadcrumbs.tsx`: below 640 px a crumb menu opens a `BottomSheet` (286–342), legend hard-coded incl. «выключен» (98–120, 305); desktop hover `DropdownMenu` (344–398), no search, no legend. Document crumb reuses the wrong legend (`src/app/(dashboard)/journals/[code]/documents/[docId]/layout.tsx:95`).
- `src/components/journals/journal-breadcrumbs.tsx`: «Журналы» crumb title «Перейти к журналу» (72); journal crumb «Журналы набора» (87–88); both use `journalMenu`.
- `src/lib/journal-crumb-menu.ts:30–89`: managers see disabled journals muted «выключен» (54–57, 73–78). Disabled codes via `parseDisabledCodes` (`src/lib/disabled-journals.ts:23`).
- `src/lib/journal-search.ts:13–28`: lower-case only, no ё→е.
- «Показать все» → `/settings/journals` («Набор журналов», manager-only: `src/app/(dashboard)/settings/journals/page.tsx:19`).
- Mini App: no separate switcher; mini CSS hides the «Журналы» crumb (`src/app/mini/mini-theme.css:698–720`) — both crumbs must get the feature.

### C. «QR» button → empty page; QR across periods

- Button: `JournalTopBar` links `/settings/qr-posters?kind=journals&ids=<routeCode ?? templateCode>`, hidden with no documents / closed tab (`src/components/journals/document-list-ui.tsx:328–337`).
- Empty because: (1) journal posters come only from `listHubJournals` (`src/lib/qr-fill-poster.ts:165–178`) which excludes object journals (`src/lib/journal-fill.ts:54, 133–156`) → «Выбранные объекты не найдены» (`qr-posters-client.tsx:190–230`); (2) `listHubJournals` needs an active doc covering today — all drop out on day 1 of a period; (3) `QrFillPreview` print links use `ids=<code>:<docId>` (`src/components/qr/qr-fill-preview.tsx:73`) never matched; (4) `kind=journal` (singular) parsed as rooms (`settings/qr-posters/page.tsx:53`) — hygiene link uses it (`hygiene-v2-table.tsx:104`); (5) `routeCode` can be an alias.
- In-document «QR: заполнить с телефона» shows a journal poster even for object journals (`src/components/journals/document-actions-bar.tsx:250, 296`).
- Today's-document lookups that fail with no doc: `src/app/journal-fill/[orgId]/[code]/route.ts` (hub 274–277; 287–291; doc-token exact id 288); `src/app/api/journal-fill/[orgId]/[code]/route.ts:48–49`; `src/lib/journal-fill-submit.ts:73–75` (409); `src/lib/health-qr-flow.ts:57–73`; `src/lib/equipment-fill-targets.ts:41–75`; `src/app/room-fill/[roomId]/page.tsx:103–120`; `src/app/api/room-fill/[roomId]/route.ts:150–170`; `src/lib/uv-lamp-runs.ts:32–80` (creates from scratch, no lock).
- Auto-create (`src/lib/journal-auto-create.ts`): `ensureActiveDocument` (515–677) guards but no lock; previous config reused only for cleaning (`fetchPreviousDocConfigForReuse` 88–106); `ensureCurrentDocumentsForBrokenChains` (1016–1130) implements the rollover rule, only in the 04:00 cron. `buildDocumentCopy`/`resolveDocumentCopyPeriod` in `src/lib/journal-document-copy.ts`. Journals whose `config.rows` are facts (brakerage, accidents…) must never be copied.

### D/E. Journal page action buttons

- `JOURNAL_LIST_ACTIONS_CLASS` vertical on mobile (`src/components/journals/journal-responsive.ts:18–19`).
- QR only in clients using `JournalTopBar` (16): cleaning-ventilation, cold-equipment (broken target), disinfectant, equipment-calibration, equipment-cleaning, equipment-maintenance, finished-product, fryer-oil, health, hygiene, incoming-control, med-book, perishable-rejection, sanitation-day, staff-training, uv-lamp-runtime.
- No QR at all (19 custom headers): accident, audit-plan, audit-protocol, audit-report, breakdown-history, cleaning, complaint, glass-control, glass-list, intensive-cooling, metal-impurity, pest-control, ppe-issuance, product-writeoff, sanitary-day-checklist, traceability, training-plan, scan-journal (audit_plan_scan, audit_report_scan, audit_protocol_scan, metal_impurity_scan), tracked (climate_control + tracked codes without own client). Plus the field-based fallback page (`src/app/(dashboard)/journals/[code]/page.tsx:4133–4160`).
- Rights: `canManage` = `hasFullWorkspaceAccess` (page.tsx:1487). Guide button `GHOST_BUTTON_CLASS` (`fill-guide-launcher.tsx:44–45`). Skeleton `journals/[code]/loading.tsx:14–17`. Gold precedent `from-[#fde68a] to-[#fbbf24]` (`journal-bonuses-editor.tsx:193, 238`).

## Design decisions

A1 Wheel picker: `WheelColumn` in `src/components/ui/wheel-picker.tsx` on native scroll + `scroll-snap-type: y mandatory`; non-passive `wheel` listener steps one item per notch; `role="spinbutton"`, `aria-valuenow/min/max`, `aria-valuetext` «25, пятница»; keys ↑/↓, PgUp/PgDn ±7, Home/End, digits; `data-vaul-no-drag`; reduced motion → instant; Mini App haptic `selectionChanged` if available. `WheelDatePicker` = day/month/year or single day column. `DateField` gets `picker="wheel"`, default stays calendar.

A2 Data model v2 per row:
```ts
export type SanitationCleaning = {
  id: string;               // "p:YYYY-MM-DD" planned | "u:YYYY-MM-DD" unplanned
  planned: string | null;   // YYYY-MM-DD within config.year
  done: string | null;      // YYYY-MM-DD, null = not done
  doneBy?: string | null;
  doneSource?: "manual" | "task";
};
// row += cleanings: SanitationCleaning[]; legacyNotes?: Partial<Record<MonthKey,{plan?:string;fact?:string}>>;
// plan/fact strings stay as a PROJECTION ("04, 11, 18" | "-" + legacy note text)
```
Source of truth `cleanings`; `normalizeSanitationDayConfig` rebuilds `plan`/`fact`. Lazy lossless migration: month rebuilt from string when row has no `cleanings` or string differs from projection; tokens: comma/semicolon, `\d{1,2}`, space-separated days, `DD.MM(.YYYY)` when MM = cell month; fact day → planned same day, else nearest undone within ±3 days, else unplanned; unrecognised («✓», «+», «по графику», «10 (перенос)») → `legacyNotes`, still printed. `shiftCleaningsToYear(config, year)` (Feb 29 → 28).

A3 Writes: cell edits via `POST /api/journal-documents/[id]/general-cleaning` op reducer under `withDocumentConfigLock`; TF/QR/task-fill completions in the adapter under the same lock; whole-config PATCH + `mergeSanitationTaskMarks` under the lock (restores task-sourced marks/unplanned slots missing in incoming). Live refresh `useLiveRefetch(…, { codes: ["general_cleaning"] })`.

A4 Plan from room schedule: `scheduledDatesInRange(schedule, from, to)` (weekly mask; monthly days + «last»; skip nonexistent days). Applied explicitly: on creation and room add (today→31 Dec, `fill-empty`); «Заполнить план по графику помещений» (preview → confirm); after room card schedule change (confirm, `replace-future`). Never touch past dates / done marks.

A5 TasksFlow: one task per planned date. `rowKey = gc::<rowId>::<YYYY-MM-DD>`; keys `gc-create::<docId>::<rowId>::<date>`, `gc-delete::<docId>::<taskId>`, `gc-complete::<docId>::<taskId>`. Pure planner compares today's open planned slots (org TZ) with `gc::` links → outbox `createTask` (new action, one-off), `deleteTask` (date dropped, not completed), `completeTask` (manager marked done). Created on the day: hourly cron `/api/cron/general-cleaning-tasks`, after changes (PATCH hook / op route), «Отправить всем» own branch (no recurring / fan-out). Outbox re-checks date still planned and no TaskLink. Assignee: room's first cleaner, else document responsible; unlinked legacy rows get no tasks (hint «Свяжите строку с помещением»). Verifier: room's first verifier if different. Completion: `gc::` key marks exactly that slot (org-TZ day); row-level key marks best open slot of current month else adds unplanned; undo clears only task-sourced. Old monthly recurring tasks removed by a one-off script (dry-run first).

B Switcher: `getJournalCrumbMenu` → `{ items, showAllHref, disabledLabels }` (only enabled; disabled current stays muted; `showAllHref` `/settings/journals` for managers else null). `Crumb` gets `menuSearch`, `menuFooterLink`, `menuLegend`, `menuHiddenMatches` for sheet and dropdown. Legend from statuses shown; documents legend «открыт / закрыт». `normalizeJournalSearch` ё→е + space collapse. Autofocus only when `(hover: hover) and (pointer: fine)`.

C QR: pure `journalQrHref(templateCode, {documentId?})` — object journals → stickers (cold → equipment; climate → rooms; uv → lamps; `layout=sheet&journal=<code>[&doc=]`), others → `kind=journals&ids=<code>[:docId]` (hygiene → `hygiene,hygiene@verify`). Posters page builds explicitly requested journal posters (any `code`/`code:docId` of the org), redirects object journals to stickers, accepts singular/plural kinds, resolves `journal=` scope, never an unexplained empty state. Rollover: `ensureQrPeriodDocuments` before every today's-document lookup in QR paths, reusing factored-out `restoreBrokenChainForTemplate` (cron rule, responsibles inherited, structure copied for a whitelist). Guards: advisory try-lock per org/journal/building; org from the signed token; skip disabled journals/paused orgs; closed doc in current period blocks; never create without a previous doc. Doc-specific token follows lineage to successor. Each creation → audit + bell.

D/E Actions: shared `JournalListActions` in `JournalTopBar`, all 19 custom headers and the fallback page (static coverage test). Row 1 gold «QR-точка контроля» full width; row 2 two columns «Создать документ» (soft indigo) | «Инструкция» (outline); lone button spans both; desktop block right of title `w-[440px]`. QR for managers on every journal and tab incl. no documents. Gold accent added to SKILL.md first; periodic light sweep disabled under reduced motion.

## Step-by-step implementation

### Phase 0: shared helpers
1. `src/lib/use-media-query.ts` (new): `useMediaQuery(q)`, `useFinePointer()`, `usePrefersReducedMotion()` (pattern of `use-narrow-viewport.ts`).
2. `src/lib/journal-search.ts`: `normalizeJournalSearch(v) = v.toLocaleLowerCase("ru-RU").replace(/ё/g,"е").replace(/\s+/g," ").trim()`; `journalMatchesQuery` requires every query word.
3. `src/lib/advisory-lock.ts` (new): `advisoryLockKey(...parts)`; `withAdvisoryTryLock(key, fn, {attempts=40, delayMs=150})` looping `db.$transaction(tx => SELECT pg_try_advisory_xact_lock(hashtext(key)))` then `fn()` (non-blocking try variant).

### A. General cleaning
4. `src/lib/wheel-date.ts` (pure): `MONTH_NAMES_RU`, `WEEKDAY_SHORT_RU`, `daysInMonth`, `clampDay`, `isoDate`, `buildDayOptions(year, monthIndex, {markedDays?, maxDate?})` → `{value, label, hint:"пт", tone:"weekend"|undefined, disabled, marked}`, `wheelSteps(acc, deltaY, deltaMode, itemHeight)`, `indexFromScrollTop`, `nearestEnabledIndex`.
5. `src/components/ui/wheel-picker.tsx`: `WheelColumn<T>({options, value, onChange, ariaLabel, valueText, itemHeight=40 (44 coarse), visible=5})`; scroller `overflow-y-auto overscroll-contain snap-y snap-mandatory`, hidden scrollbar, padding `itemHeight*2`; edge fade `mask-image`; centre band `rounded-xl bg-[#f5f6ff] ring-1 ring-[#ececf4]`; selected `text-[#3848c7] font-semibold`, others `#9b9fb3`, weekend `#a13a32`; commit on `scrollend` + 120 ms fallback; click selects; keyboard/wheel; external sync `scrollTo`; `data-vaul-no-drag`.
6. `src/components/ui/wheel-date-picker.tsx`: `WheelDatePicker({value, onChange, mode:"full"|"day", year?, month?, minYear?, maxYear?, maxDate?, markedDays?})`; full = day|month|year (clamp day); day = one column with weekday; footer «Сегодня», «Готово».
7. `journal-dialog-field.tsx`: `DateField` `picker?: "calendar"|"wheel"`; wheel → popover shows `WheelDatePicker` (full, `w-[300px]`); typing ДД.ММ.ГГГГ still works.
8. `src/lib/general-cleaning-schedule.ts` (pure): `RoomGeneralSchedule = {scheduleType; weekdayMask; monthDays}`; `roomGeneralSchedule(room)` (null if unset); `scheduledDatesInMonth`, `scheduledDatesInRange(s, fromKey, toKey)`; `describeGeneralSchedule(s)` («каждую пятницу» / «1 и 15 числа, последний день месяца», reuse `describeMask`).
9. `sanitation-day-document.ts`: `SanitationCleaning`, `cleanings`/`legacyNotes`, prefixes `p:`/`u:`; `parseMonthCellTokens(text, year, monthIndex)` → `{days, notes}`; `reconcileRowCleanings(rawRow, year)`; `projectMonthCell(cleanings, notes, year, monthIndex, "plan"|"fact")` (two-digit days ", ", then notes, or "-"); `normalizeRows` keeps `cleanings` (validated, de-duped, sorted) + `legacyNotes` and ALWAYS recomputes plan/fact; `monthCleanings(row, monthIndex)` → `{planned, unplanned}`; `shiftCleaningsToYear(config, year)`; `buildSanitationDayConfigFromRooms(rooms, date, {fromKey?})` and `createEmptySanitationRow(name, roomId?, schedule?, fromKey?)` fill `cleanings` from schedules.
10. Seeding: `api/journal-documents/route.ts:428` add schedule fields to rooms select, pass `fromKey = today` at ~705; `journal-default-configs.ts:96` optional fields; `journal-responsibles-cascade.ts:79–83` select them.
11. `src/lib/general-cleaning-ops.ts` (pure): `applyGeneralCleaningOp(config, op, ctx:{todayKey, userId, schedules})` → `{config, changed, touchedDates}`; ops `addPlanned`, `removePlanned{dropDone?}`, `movePlanned`, `markDone` (≤ today, not before planned−7), `unmarkDone`, `addUnplanned`, `removeUnplanned`, `clearLegacyNote`, `legacyNoteToDone`, `fillFromSchedule{rowIds?, months?, mode:"fill-empty"|"replace-future", fromDate}`, `shiftYear{year}`; results normalized.
12. `src/lib/general-cleaning-merge.ts` (pure): `mergeSanitationTaskMarks({incoming, current})`.
13. `src/app/api/journal-documents/[id]/general-cleaning/route.ts` (POST {op}, zod union): auth like config-only PATCH (`[id]/route.ts:163–186`), closed → 400, org check, `fillFromSchedule`/`shiftYear` management-only; rooms schedules + `orgTodayKey(org.timezone)`; `withDocumentConfigLock`; after commit `void syncDocumentToTasksFlow(...)` + AuditLog `general_cleaning.op`; returns `{config}`.
14. `[id]/route.ts:562–571`: branch for general_cleaning with `mergeSanitationTaskMarks` under the lock.
15. `src/components/journals/general-cleaning/month-cell.tsx`: `GeneralCleaningMonthCell` button with aria-label, chips grid (done `bg-[#ecfdf5] text-[#116b2a]`; overdue `bg-[#fff4f2] text-[#a13a32]`; future `bg-[#f5f6ff] text-[#3848c7]`; legacy note grey italic), `print:` plain.
16. `month-editor.tsx`: `GeneralCleaningMonthEditor` (Popover desktop, BottomSheet <640 px): header «Сентябрь 2026 · Кухня»; schedule line + «Заполнить по графику»; planned chips → «Отметить выполненной» (day wheel, ≤ today), «Перенести», «Убрать из плана» (`confirmAsync` if done); «Добавить дату» (day wheel, planned disabled «в плане», default next free scheduled day); «Внеплановая уборка» (maxDate today); legacy note actions; footer hints (TF connected + linked → «В день уборки исполнитель получит задачу в TasksFlow»; unlinked → «Свяжите строку с помещением — иначе задачи не придут»).
17. `year-sheet.tsx`: `GeneralCleaningYearSheet` (mobile): 12 months «4 уборки · 2 выполнены» → month editor in the same sheet.
18. `sanitation-day-document-client.tsx`: `postOp(op)` via `saveChainRef`; replace grid inputs with cell + editor; cards → year sheet; summaries via `monthCleanings`; delete dead `includePlanFields`; both date inputs → `<DateField picker="wheel" label="Дата документа">`; year change with cleanings → `confirmAsync` → `shiftYear`; toolbar «Заполнить план по графику помещений» with live-preview confirm → `fillFromSchedule`; `addRoomFromDirectory` seeds schedule; room card `onSaved` schedule change → confirm → `replace-future` for that row; `useLiveRefetch`; prop `tasksflowEnabled` from the doc page (`[docId]/page.tsx:859–875`).
19. `sanitation-day-documents-client.tsx:235–250`: `DateField picker="wheel"` label «Дата документа»; `create-document-dialog.tsx:850–866`: `picker="wheel"` for general_cleaning.
20. PDF `document-pdf.ts:4478, 4482`: `monthCell(text)` with fontSize 7 when ≥3 tokens.
21. `journal-document-copy.ts:176–184`: for rows with `cleanings` keep planned shifted to the new year, drop unplanned and done, keep `legacyNotes[*].plan`, drop `.fact`; legacy rows unchanged. ALSO export `copyDocumentStructure(code, config, periodFrom)` extracted from `buildDocumentCopy` (strip common fact fields, reset facts, year/documentDate) for journals with copy support — needed by C step 45.
22. `demo-organization.ts:926–955`: generate `cleanings`.
23. `src/lib/tasksflow-adapters/sanitation-day-tasks.ts` (pure): `gcRowKey`/`parseGcRowKey` (`/^gc::(.+)::(\d{4}-\d{2}-\d{2})$/`), key builders, `planGeneralCleaningTasks(input)` → `{create[], complete[], remove[], skippedNoLink[]}` (title «Генеральная уборка · Кухня · 25.09 (пт)», `journalLink` `{kind:"wesetup-general_cleaning", baseUrl, integrationId, documentId, rowKey, label, isFreeText:false, bonusAmountKopecks:0, taskScope:"personal", siblingVisibility:false}`), `applyTaskCompletion(config, {rowKey, doneKey, completed})`.
24. `src/lib/tasksflow-outbox-actions.ts` (pure): `OutboxCreateTaskPayload`, `parseCreateTaskPayload`, `enqueueOutbox(tx|db, {...})` (P2002 = already queued; `gc-create` delivered but link missing → reset to pending).
25. Outbox cron: move `taskId` check after the switch; `case "createTask"` (parse; guard `isGeneralCleaningDatePlanned` → delivered «skipped: unplanned»; existing link → delivered; `client.createTask(task, {idempotencyKey})`; create TaskLink; P2002 → enqueue `deleteTask` for orphan).
26. `sanitation-day.ts` adapter: `listDocumentsForOrg` keeps row-level keys + sublabel «По плану сегодня» / «Следующая: 25.09»; `syncDocument` via planner + outbox in one transaction, no direct TF calls, never touches `verifier-summary:`; `applyRemoteCompletion` with org-TZ `doneKey` under the lock (closed doc → false); `getTaskForm` parses rowId from `gc::`; keep `scheduleForRow`/`monthDayForRoom`.
27. `src/app/api/cron/general-cleaning-tasks/route.ts` (hourly, `checkCronSecret`): for enabled integrations of non-paused orgs, active general_cleaning docs covering org today → `syncDocument`.
28. `bulk-assign-today/route.ts` (~787): general_cleaning branch → planner (dry-run lists only `plan.create` recipients; else enqueue); `continue` (no recurring, no fan-out).
29. `scripts/migrate-general-cleaning-tf-tasks.ts` (dry-run default, `--apply`): non-`gc::` filler links → enqueue `deleteTask` (`gc-legacy-delete::<linkId>`) and delete link; counts per org.
30–31. `journal-doc-guides.ts:550+` whenToFill; `docs/FEATURES_AND_AUTOMATION.md` cron row (crontab `5 * * * *`).

### B. Journal switcher
33. `journal-crumb-menu.ts`: `JournalSwitcherMenu = {items, showAllHref, disabledLabels}` as decided.
34. `src/lib/crumb-menu.ts` (pure): `filterCrumbMenu`, `legendEntriesFor`, `JOURNAL_STATUS_LEGEND`, `DOCUMENT_STATUS_LEGEND`, `matchingHidden`.
35. `breadcrumbs.tsx`: `Crumb` + `menuSearch`, `menuFooterLink`, `menuLegend`, `menuHiddenMatches`; data-driven `StatusDotLegend`; `CrumbSearchInput` (`type="search"`, `enterKeyHint="go"`, clear button, Enter → first match, h-10/h-11 styles, autofocus only fine pointer, reset on close). Sheet: sticky search, filtered rows, empty state «Ничего не нашлось по «…»», hidden-matches hint with link, footer legend + «Показать все» row. Dropdown: sticky search, stop Radix typeahead (stopPropagation printable/Space), ↓ to first item, Escape clears first, focus input on open for fine pointer, don't close on mouse leave with query, prevent hover focus stealing while filtering, bottom separator + legend + «Показать все».
36. `journal-breadcrumbs.tsx`: `journalMenu: JournalSwitcherMenu`; both crumbs get search («Найти журнал»), footer link «Показать все», legend, hidden matches.
37. Document layout `[docId]/layout.tsx:95` and `verify/page.tsx`: `menuLegend: DOCUMENT_STATUS_LEGEND`.
38. Mini App: verify under cookie `ws-shell=mini`.

### C. QR target and QR across periods
39. `src/lib/journal-qr-target.ts` (pure, client-safe): `JOURNAL_OBJECT_QR_KINDS`, `journalQrHref`, `parseQrPosterKind`.
40. `src/lib/qr-journal-scope.ts` (server): `resolveJournalObjectScope(orgId, code, todayKey, documentId?)` → `{title, ids, source}` (cold from active docs' `sourceEquipmentId` → latest doc → fridge/freezer equipment with norms (`cold-equipment-document.ts:327–333`); climate rooms; uv `isUvLampType` / doc's `config.equipmentId`).
41. `qr-fill-poster.ts`: `loadQrPosters({…, explicitIds?})` builds explicit journal posters via `loadQrPoster` with missing reasons; hub `listHubJournals(…, {includeLapsed:true})`; `QrPoster.notice?` in `qr-fill-types.ts` («Прошлый период закончился — при первом сканировании откроется новый документ по образцу прошлого» / «У журнала ещё нет документа — создайте первый»).
42. `settings/qr-posters/page.tsx`: `parseQrPosterKind`; object journal id → `redirect(journalQrHref(code))`; `journal=` scope → `journalTitle`; `doc` precedence; pass `missing`.
43. `qr-posters-client.tsx:190–230`: explained empty states (links to «Оборудование» / «Точки и помещения» / the journal), missing reasons, scope label, `notice` `print:hidden`.
44. `document-actions-bar.tsx:247–257, 283–305`: object journals → «QR-наклейки объектов» → `journalQrHref(code, {documentId})`; fix `hygiene-v2-table.tsx:104` → `journalQrHref("hygiene")`.
45. `src/lib/journal-structure-carry.ts` (pure): `carryStructureFromPrevious(code, prevConfig, {liveEquipmentIds, liveRoomIds})` (cold equipment minus dead + skipWeekends; climate rooms minus dead + controlTimes + skipWeekends; uv whole config; copy-supported journals via `copyDocumentStructure` from journal-document-copy.ts; else null). Never copy fact-rows journals.
46. `journal-auto-create.ts`: `ensureActiveDocument` `carryPreviousStructure?`; extract `restoreBrokenChainForTemplate(db, {...})` from 1062–1127 wrapped in `withAdvisoryTryLock(advisoryLockKey("journal-period", org, code, buildingId ?? "-"))`; cron uses `carryPreviousStructure: true`.
47. `src/lib/journal-qr-rollover.ts`: `ensureQrPeriodDocuments({organizationId, templateCode, todayKey, anchor?})` → `{status:"active"|"created"|"none", documentIds, reason?}` (skip disabled/paused; targets anchor doc building → anchor building → `buildingTargets(org)`; `now = new Date(todayKey+"T12:00:00Z")`; on created: `closeExpiredDocuments({templateId})`, AuditLog `journal_document.qr_rollover`, `notifyManagement({kind:"journal.qr-rollover", dedupeKey:"qr-rollover:"+docId, title:"Начат новый период «…» — документ создан при записи по QR", linkHref})`); `resolveTokenDocuments(...)` (token doc if active today, else same-lineage successor, else [] + reason).
48. Hooks: journal-fill page route (hub `includeLapsed`; ensure + list + `resolveTokenDocuments`; messages «Документ за этот период закрыт руководителем — попросите вернуть его в активные», «Кабинет организации приостановлен»); `api/journal-fill/[orgId]/[code]/route.ts:48`; `journal-fill-submit.ts:73` (map to successor instead of 409); `health-qr-flow.ts:57–73` (ensure companion if enabled); `equipment-fill-targets.ts:41–75`; `room-fill/[roomId]/page.tsx:103` + `api/room-fill/[roomId]/route.ts:150` (climate, anchor room.buildingId); `uv-lamp-runs.ts:32–80` (copy from lamp's previous doc under `withAdvisoryTryLock(advisoryLockKey("uv", org, lampId, monthKey))`); `listHubJournals(…, {includeLapsed})` (`journal-fill.ts:133`).

### D + E. Page actions
49. SKILL.md «Gold accent — QR-точка контроля» (tokens `#fff3c4 / #fcd34d / #f5b301 / #dc9d00`, ink `#5b3a00`, sweep rule); `globals.css` `@keyframes qr-point-sheen` + `.qr-point-sheen::after` (45 %-wide white gradient every 5.5 s after 1.2 s, off under reduced motion).
50. `src/components/journals/journal-list-actions.tsx`: `JournalQrPointButton({templateCode})` (Link to `journalQrHref`, `QrCode` icon, «QR-точка контроля», aria-label «QR-точка контроля — плакат и наклейки для записи в журнал с телефона», `LinkPendingSpinner`); `JournalListActions({templateCode, journalName, create?, guideProps?, canManage?})` grid `grid w-full grid-cols-2 gap-2 sm:w-[440px] sm:shrink-0`, QR managers-only `col-span-2`, create left, `FillGuideLauncher` right, lone item `col-span-2`; classes `JOURNAL_QR_POINT_CLASS` = `qr-point-sheen relative isolate col-span-2 inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#fff3c4_0%,#fcd34d_40%,#f5b301_75%,#dc9d00_100%)] px-4 text-[15px] font-semibold text-[#5b3a00] shadow-[0_12px_30px_-14px_rgba(220,157,0,0.75),inset_0_1px_0_rgba(255,255,255,0.65)] ring-1 ring-[#e8b320]/60 transition-[filter,box-shadow,transform] duration-200 hover:brightness-[1.04] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f5b301]/35 motion-reduce:transition-none`, `JOURNAL_ACTION_CREATE_CLASS` soft indigo `h-11 rounded-2xl bg-[#eef1ff] text-[#3848c7] hover:bg-[#e2e7ff] text-[14px] px-2.5`, `JOURNAL_ACTION_GUIDE_CLASS` outline `border-[#dcdfed] bg-white hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]`. Empty state keeps its large primary create button.
51. `JournalTopBar` (`document-list-ui.tsx:250–354`): render `JournalListActions` with `templateCode`; `create` = `createSlot` or `<CreateDocumentDialog triggerClassName={JOURNAL_ACTION_CREATE_CLASS} …/>` when `canManage && activeTab==="active" && documentCount!==0`; remove old QR link.
52. 19 custom list clients + fallback page `page.tsx:4133–4160` (create = «Новая запись» link) → `JournalListActions`; `loading.tsx` skeleton «full-width h-12 + 2×h-11».
53. Coverage test `src/lib/journal-list-actions-coverage.test.ts`.

### Release (main session)
54. WhatsNew, commit (Russian), push; INFRA: hourly `general-cleaning-tasks` cron; after deploy run the legacy TF script dry-run then `--apply`.

## Tests
Unit (node:test): wheel-date, general-cleaning-schedule, sanitation-day-document (conversions, idempotent normalize, pairing, external edit, shiftYear, roomId kept), general-cleaning-ops, general-cleaning-merge, tasksflow-adapters/sanitation-day-tasks, tasksflow-outbox-actions, journal-document-copy (v2 case), journal-search, crumb-menu, journal-qr-target, journal-structure-carry, journal-qr-rollover (`resolveTokenDocuments`), advisory-lock, journal-list-actions-coverage; `src/domain/journal/adapter-contract.test.ts` stays green.

E2E (`.agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/`): gc-setup/gc-e2e (A-1…A-7 incl. mock TF on :4999), switcher-e2e (B-1…B-5), qr-e2e (C-1…C-9, D-1, D-2, E-1). Evidence: typecheck, `npm run test:gate`, e2e JSON, screenshots in `shots/`.

## Risks
Outbox lock on pool connections (use xact lock if flaky); stale tabs PATCHing old strings (dates survive, doneBy lost — acceptable); Radix dropdown + input (fallback Popover listbox); vaul + wheel on iOS/Telegram (real-device QA); structure copying changes the 04:00 cron output for cold/climate/uv (intended, WhatsNew line); document creation from a public GET (HMAC token, idempotent, guarded); old monthly TF tasks until the script runs; taller grid rows / PDF 7 pt.

## Defaults for open questions
1. Run `scripts/migrate-general-cleaning-tf-tasks.ts --apply` after reviewing the dry-run: yes.
2. Assignment falls back to the document responsible for linked rooms without cleaners: yes; unlinked legacy rows get no automatic tasks.
