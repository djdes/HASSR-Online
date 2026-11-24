# Evidence — site-motion-round2-2026-11-22

Builder evidence for `spec.md`. Raw artifacts are in `raw/`.

## What was built

| Piece | Where |
|---|---|
| What appears and disappears: content after placeholders, a new row, the saved mark, hand-built windows that play out, pull-down on a phone | `src/components/motion/motion-presence.ts` (started by `MotionRuntime`), pure part in `motion-model.ts` |
| Styles: new row, saved mark, the copy of a closing window, the handle of a sheet, off switches | `src/app/motion.css`, sections 8–11 |
| Segment styles and the token of the chosen pill | `src/components/ui/segment-styles.ts`, `--app-segment-pill` in `src/app/app-theme.css` |
| Converted to segments | `ChoicePills`, «Идеи» (sort, filter), «Партии», «ЭДО», «Продукты», the label log |
| Empty state of a journal | `src/components/journals/journal-empty.tsx`; used in `RecordCardsView` (31 journals on a phone) and six tables (acceptance ×2, climate, equipment maintenance, intensive cooling, tracked journals, traceability) |
| Generated layers refreshed | `src/app/borderless.css` (file count), `src/app/neutral-palette.css` (one hover border colour is no longer used) |

## Checks

| Check | Result | Artifact |
|---|---|---|
| `npm run typecheck` | exit 0 | `raw/typecheck.txt` |
| `npm run test:gate` (targeted, 5 files) | pass 56, fail 0 | `raw/test-gate.txt` |
| Motion tests (`src/app/motion.test.ts`, `src/components/motion/motion-model.test.ts`) | 44 / 44 (13 new for round 2) | `raw/unit-tests.txt` |
| Design guards and every test that reads the touched files | 302 / 302 | run in the session |
| ESLint on the 20 changed `.ts` / `.tsx` files | 0 errors; 15 warnings, all unused variables that were there before in the large journal clients | `raw/eslint.txt` |
| Browser measurements, round 2 | 19 / 19 | `raw/measure.json`, script `raw/measure-round2.cjs` |
| Browser measurements, round 1 (regression) | 46 / 46 | run in the session with `site-motion-2026-11-22/raw/measure.cjs` |
| Crawl: 24 cabinet pages × desktop and phone | no page or console errors, no leftover shapes, copies or marks | `raw/crawl.txt` |
| Production minifier on `motion.css` | nothing dropped | `raw/prod-minify.json` |

## Acceptance criteria

- **AC1 — PASS.** After a placeholder is replaced, three blocks enter with delays 0 / 45 / 90 ms,
  0.32 s each; the first two rise (opacity + translate), the one that holds a fixed element only
  fades. Content added without a placeholder gets no animation.
- **AC2 — PASS.** A row appended alone: `data-row-new`, the row plays `motion-row-in`, its cells
  `motion-row-new`; the first row that replaces «Строк пока нет» and an item added to a
  `data-motion-list` are marked too; the mark is gone after 1.8 s. Five rows at once and a moved
  row are not marked.
- **AC3 — PASS.** After a 2xx `PATCH` to the journal API the mark sits inside the touched cell
  (green `rgb(28, 150, 85)`), is gone after 1.5 s, and the caller reads the same response body.
  Nothing after a 500, after a GET, or when no cell was touched.
- **AC4 — PASS.** Closing «Завершите регистрацию»: the real window is gone at once, its copy
  goes from opacity 1 / scale 1 to 0.40 / 0.98 on the last sampled frame and is removed 0.24 s
  after it appeared (the animation is 0.16 s); none is left. The copy has `pointer-events: none`,
  `inert`, `aria-hidden`, no ids or field names, no animation of its own, and shows the value
  typed into the field.
- **AC5 — PASS.** Phone: the sheet has the handle; pulled 55 px by its top it follows the
  finger and springs back; a pull that starts 200 px below the top does not move it; pulled
  140 px it closes (real window gone, its copy plays out and is removed).
- **AC6 — PASS.** «Идеи», «Партии» (links, the URL gets `?status=`), the label log: the pill
  flows (43–44 frames, 110–228 px), stays inside the track, nothing is left; idle items have no
  fill and no border, the chosen one is white on the veil track; in the dark theme the pill is
  `rgba(255,255,255,0.14)` on a `0.06` track.
- **AC7 — PASS.** The empty acceptance table shows the icon above «Строк пока нет» inside the
  cell (icon `print:hidden`); on a phone the cards view shows a veil box with the icon and
  «Поставок пока не зарегистрировано.», no dashed border.
- **AC8 — PASS (ruled out).** The list is not clipped: one option, 45 px, no overflow, no
  scrollbar. The arcs at the corners are the indigo «+» button of the next form row showing from
  under the rounded corners of the panel — the panel covers that row exactly. Not a defect of the
  component; nothing changed.
- **AC9 — PASS.** With the system «Reduce motion»: nothing enters, a new row is not marked, a
  closed window leaves no copy, the saved mark is shown without animation (opacity 1). Guards in
  `motion.test.ts`: no `will-change`, gradient, lively spring, out-of-range bezier in the new
  module; print hides the mark and the copy.
- **AC10 — PASS.** See «Checks».

## Limits

- AC1–AC3 are measured on DOM changes made inside the live page (a placeholder swapped for
  content, a row appended, a request to a stubbed journal URL): the local database has too little
  data to drive the real screens through every case.
- Touch is CDP touch events in Chromium (iPhone 13 profile), not a real finger.
- AC6: the tabs of «Продукты» were converted but not seen in the browser — the local catalogue
  is empty and the page hides the tabs.
