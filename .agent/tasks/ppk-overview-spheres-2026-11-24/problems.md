# Problems: ppk-overview-spheres-2026-11-24 (verifier, round 1, 2026-11-24)

Verdict: **FAIL**. AC6 fails (V1, major). There are also two major layout regressions on phones (V2, V3).
AC1–AC5 and AC7 pass on their own wording.
Judged: the uncommitted tree on top of `c73c13e69`. The stand (:3000) was built from these sources.
The full detail, check results and measurements are in `verdict.json`.

## Must fix

### V1 (major, AC6 c): the section nav under an active filter corrupts navigation

`src/components/production-control/structure/structure-explorer.tsx:79-91`. The chip is `<a href="#ppk-section-…">`. Its `onClick` calls `preventDefault()` only when the section is rendered (`if (!target) return;` at :86).
When a filter hides a section, the click falls through to a native fragment navigation. Nothing visible happens.
The browser pushes a history entry with `history.state === null`. Next's `onPopState` ignores null-state entries (`node_modules/next/dist/client/components/app-router.js:272-276`).
So the next item window's close (`router.back()` in `item-dialog.tsx`) lands on that entry, while the router stays on `/production-control/item/<id>`.

Reproduced on the stand (Chromium 1440×900):

1. Open `/production-control` and choose the «Частично» filter.
2. Click the chip «2. План ХАССП». Its section is hidden, so nothing scrolls. The URL becomes `/production-control#ppk-section-plan` and `history.state` is `null`.
3. Open item 1.1 and press Escape. The window closes, and the URL is `/production-control#ppk-section-plan`.
4. Click item 1.1 again. **No window opens.** The URL changes to `/production-control/item/1-1`, but the dialog keeps its closed state.

It follows from the code that `PpkStructureRefresh` waits for `pathname === "/production-control"`. In this state it no longer refreshes statuses after edits either.

**Smallest fix.** Always call `event.preventDefault()` in that handler. If the target section is not rendered, first reset the filter, then scroll:

```tsx
onClick={(event) => {
  event.preventDefault();
  const id = `ppk-section-${section.key}`;
  if (!document.getElementById(id)) flushSync(() => setFilter("all")); // import { flushSync } from "react-dom"
  const target = document.getElementById(id);
  if (!target) return;
  ...scrollIntoView / focus as now
}}
```

Another option is to make the chips buttons without `href`.

### V2 (major, regression from the rename): object name crushed on the objects list on phones

`src/app/(dashboard)/settings/buildings/buildings-client.tsx:658-678`. The card header row is `flex items-center gap-2` and does not wrap. It holds the icon, the name `<h2>`, the sphere chip and the pin.
The new label «Общественное питание и производство пищевой продукции» turns the chip into 124×106 px (5 lines). On an iPhone 13 at `/settings/buildings`, the name «Кафе «Ромашка»» shrinks to a 40 px column and reads «Каф / е / «Ро / маш / ка»».
With the previous label «Общепит ХАССП» the name was 81 px wide. Food is the main sphere. The uz label is even longer.

**Smallest fix.** Make line 658 `flex flex-wrap items-center gap-x-2 gap-y-1` and add `min-w-0` to the `<h2>`. The chip then moves under the name on narrow screens. Desktop is unchanged: at 1280 the chip is one line, 370 px.

### V3 (major, Р2 «компактнее на странице»): the starter card is taller on phones than before

`src/components/production-control/ppk-starter-wizard.tsx:87-101`. The text `<p>` is `min-w-0 flex-1`, so its flex basis is 0. `flex-wrap` never moves the 185 px button to the next line, and the text is squeezed beside it.

I measured the new card against the previous markup from HEAD, both rendered on the same page:

| Device | New card height | Previous card height | New text column | Previous text column |
|---|---|---|---|---|
| iPhone 13 (390) | 329 px | 245 px | 101 px | 256 px |
| 320 px phone | 391 px | 314 px | 31 px | 186 px |
| Pixel 7 (412) | 247 px | 222 px | 123 px | 278 px |

Desktop is fine: 56–57 px at 1280, 1366, 1440 and 1920.

**Smallest fix.** Give the text a real basis so the button wraps under it on phones, e.g. `min-w-[14rem] flex-1` on the `<p>` (or `basis-full sm:basis-0 sm:flex-1`). Optionally make the button `w-full sm:w-auto`. Re-check that the desktop card stays ≤ 72 px.

## Should fix (minor, not blocking)

- **V4.** `production-control/page.tsx:88-89`. For a medical, consumer or sport object, the card stays after its 3 sphere blocks are filled, because the condition is still «all blocks < 40 %». The dialog then opens with Fill disabled and «Всё уже заполнено, ничего не добавлено», which is past tense before any action (`ppk-starter-wizard.tsx:175`). Hide the card when every block of `starterBlocksFor(defaultSphere)` is filled.
- **V5.** `api/production-control/starter/route.ts:33`. `{ sphere: "food" }` without `kind` returns 400, although the contract is `{ sphere, kind? }`. Default `kind` to `"cafe"` when a sphere is given.
- **V6.** `globals.css:1151-1156`. Р5 says «прокрутка блокируется на html». The fix only stops `<body>` being a scroll container; wheel and touch are still blocked by react-remove-scroll, while the keyboard and the scrollbar can still scroll. This is the same as before, not a regression. Note the deviation in the evidence.
- **V7.** `production-control/page.tsx:77`. `loadOverviewSignals(scope)` has no fallback. An error in revision fingerprints would now take down the default overview. Use `.catch(() => null)`, which falls back to the classic page.
- **V8 (pre-existing).** `ppk-starter-wizard.tsx:72`. The toast says «1 норматив» (it counts records), while the dialog promised 7 or 10.
- **V9 (polish).** The review date is always `dd.mm.yyyy` (`overview.server.ts:41`), also in en and uz. The new radiogroups have no arrow-key navigation (an existing pattern in the codebase). Truncated section chips have no `title`. The ack tile is green for «0 из 0».

## What passed (re-run by the verifier)

- `npm run typecheck`: exit 0.
- ESLint on the 26 changed files: 0 errors.
- Targeted tests: 31/31.
- The 81 test files that `test:changed` selects: 375/375.
- Design and related tests: 136/136.
- `npm run i18n:check`: 103/103.
- Stand e2e `raw/e2e-tz2.mjs`: 52/52.
- Jump probe: 0/4 jumps.
- Kill switch `PPK_OVERVIEW_CLASSIC=1`: PASS, on a temporary :3001 server, since stopped.
- Revision badge at the organisation scope: «ППК 002».
- A standalone item page followed by the overview still lands at the top.

## Решения сборщика (после раунда 1)

| Замечание | Решение |
|---|---|
| V1 (major) | `structure-explorer.tsx`: `preventDefault()` — всегда; раздел скрыт фильтром — фильтр сбрасывается на «Все» (`flushSync`), затем прокрутка к разделу. В историю не попадает запись без `state`. Стенд: проверка «V1 …» — фильтр сброшен, адрес без `#`, `history.state` не null, окно 1.1 после закрытия открывается снова. |
| V2 (major) | `buildings-client.tsx`: строка заголовка карточки объекта — `flex-wrap`, у названия `min-w-0 break-words`: длинная сфера на телефоне уходит под название. Стенд: «V2 телефон …» — ширина названия ≥ 100 px, сфера не выше двух строк. |
| V3 (major) | `ppk-starter-wizard.tsx`: текст карточки не уже 14rem (`min-w-[14rem] flex-1`), на телефоне кнопка уходит под текст и растягивается (`w-full sm:w-auto`). Стенд: «V3 телефон …» — карточка ≤ 160 px, текст ≥ 220 px; компьютер — по-прежнему ≤ 72 px (AC2). |
| V4 (minor) | `page.tsx`: карточка мастера — только пока у сферы объекта есть пустые разделы (`starterBlocksFor(starterSphere)`); в окне при пустом итоге — «Эти разделы уже заполнены — добавлять нечего.» (`starter.nothingToAdd`, ru/en/uz) вместо прошедшего времени. |
| V5 (minor) | `starter/route.ts`: при указанной сфере вид необязателен (общепит — «кафе»); прежний запрос без сферы по-прежнему требует вид. |
| V6 (minor) | Принято как отклонение от формулировки Р5: `<body>` больше не область прокрутки, колесо и касание гасит react-remove-scroll, клавиатура и полоса прокрутки — как до задачи (у `<html>` и раньше была своя прокрутка). Убирать полосу у `<html>` нельзя — вернётся сдвиг кабинета на ширину полосы (замечание владельца 2026-11-23). |
| V7 (minor) | `page.tsx`: сбой `loadOverviewSignals` пишется в лог и показывает прежний вид (кнопка — «Новый вид»). |
| V8 (minor, было до задачи) | Сообщение после заполнения — число документов нормативов из пакета, как в окне. |
| V9 (polish) | Разделы — с `title` (полное название при обрезке); плитка ознакомления зелёная только при Y > 0. Дата пересмотра оставлена `дд.мм.гггг` (так же пишут даты в uz; en — понятно), стрелки в группах кнопок — как в остальном кабинете. |
