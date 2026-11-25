# Problems — special-mode-past-days-2026-11-25 (verifier, 2026-11-25T13:59Z, HEAD f7626c263)

Verdict: **FAIL** — AC1 and AC3 have one blocking problem each. AC2, AC4, AC5, AC6 pass. Server rules
(PUT, bulk, PATCH/DELETE, org lock, automation documents, future days) behave as the spec says on the stand.

## P1 (blocking, AC1): the quiet link now leads non-managers to «Нет доступа»

**What.** The new menu item `{ id: "special", href: "/inspection/settings", access: ADMIN }`
(`src/lib/app-nav.ts:547`) replaced `hiddenMatch: ["/inspection/settings"]`. The menu model treats an item's
`access` as the page's access: `closedNavHrefs()` / `deniedNavHrefs()` (`app-nav.ts:945-982`) now list
`/inspection/settings` for everyone without `admin.full`, and `SectionFrame`
(`src/components/layout/section-frame.tsx:59`) shows «Нет доступа к этому разделу» instead of the page. The page
guard still admits `hasFullWorkspaceAccess || tasks.verify`, and «К вам пришла проверка»
(`src/app/(dashboard)/inspection/page.tsx:223`) still shows those users the quiet link «Настройки раздела» to it.
Spec R1: «остальным — как было (тихая ссылка, страница только для просмотра)». Affects staff with «проверка задач»
and management roles without `admin.full` (head_chef/technologist presets).

**Repro.** Staff user with role `cook` and preset `head_chef` → `/inspection`: no card, no menu item, quiet link
present (all correct) → click it → `[data-access-denied=forbidden]`, no `[data-inspection-special-mode]`.
`deniedNavHrefs({ role: "cook", permissionPreset: "head_chef" }, facts)` contains `/inspection/settings`.
Evidence: `raw/verifier-round1/verifier-e2e-output.txt` (V1), `raw/verifier-round1/screens/v1-verifier-settings-page.png`.

**Smallest fix (keeps the spec as written).** Let a menu item have a wider page rule than its visibility:
- `NavMenuItem`: optional `pageAccess?: NavAccess` (the page's own guard when it admits more people than see the item);
- `closedNavHrefs()`: `visit(item.href, item.pageAccess ?? item.access)`;
- item: `{ id: "special", …, access: ADMIN, pageAccess: fullAccessOr("tasks.verify") }`;
- test «правило каждой вкладки и карточки повторяет guard страницы»: check `pageAccess ?? access` against the page;
- `app-nav.test.ts`: `verifyOnly` and `headChef` do not get `/inspection/settings` in `deniedNavHrefs`, and
  `visibleItemIds(verifyOnly, "inspection")` still has no `special`.

(The alternative — make the page `admin.full`-only and drop the quiet link for others — changes R1 and needs the
owner's decision.)

## P2 (blocking, AC3): the first «Включить» dialog pre-ticks «Правка прошлых дней»

**What.** `preset()` in `src/components/inspection/inspection-special-mode-card.tsx:47-52` ticks every entry of
`AUTOMATION_FEATURES` when the organisation has no previous choice (`AUTOMATION_OFF`: every new organisation).
`pastDays` is now in that list, so the first dialog shows «Правка прошлых дней» ticked with 7 days. Confirming the
dialog as offered (for example only to get autofill) opens the last 7 days to staff, opens automation documents
and overrides «Запретить редактирование записей за прошлые дни» for those days. Spec R3: «По умолчанию выключена:
у новых организаций…»; the owner: past-day editing is forbidden by default and is allowed explicitly. Stored
defaults are correct (parse, saved choice without the key, legacy — verified on the stand); only the dialog default
is wrong. No test covers it; the builder's stand script ticks the box only if it is unticked.

**Repro.** Set the special mode to all boxes false, disabled (new-org state), open `/inspection` as owner, flip the
switch → `[data-special-mode-option=pastDays]` has `data-state="checked"`. Evidence:
`raw/verifier-round1/verifier-e2e-output.txt` (V2), `raw/verifier-round1/screens/v2-enable-dialog-defaults.png`.

**Smallest fix.** In `preset()` tick everything except `pastDays` when there is no previous choice:
`AUTOMATION_FEATURES.map((feature) => [feature, feature !== "pastDays"])`, and say in its docblock that past-day
editing is only ever ticked by hand. Add a test (e.g. move the preset into a pure exported helper and assert that for
`AUTOMATION_OFF` every automation box is ticked and `pastDays` is not; or a source-level assertion in
`special-mode-past-days.test.ts`), and make the stand scenario assert the box is unticked before it clicks it.

## Minor (non-blocking, pre-existing — not introduced by this change)

- `entries/route.ts:113`, `entries/bulk/route.ts:142`: the scope check uses `String(date).slice(0, 10)` but the row
  is written at the parsed, UTC-normalised date. `"2026-11-24T00:00:00+14:00"` passes as 24th and is stored on the
  23rd → one extra day beyond the window (and yesterday when the mode is off). Derive the key from the normalised
  date. Evidence: `raw/verifier-round1/offset-probe.txt`.
- `entries/route.ts:221`: PUT with `entryId` moves any entry of the document; only the target is scope-checked, so
  staff can move a colleague's (or an out-of-window) entry onto their own row. Evidence: `raw/verifier-round1/move-probe.txt`.
- `src/app/(dashboard)/inspection/settings/page.tsx:14-22`: the docblock still describes the hidden 2026-11-05
  state (no menu item, title «Настройки раздела»).
