# Motion, round 2: content after placeholders, closing windows, journal rows, segments, empty states

- **Task ID:** `site-motion-round2-2026-11-22`
- **Frozen:** 2026-11-22, before implementation
- **Base:** `origin/master` `ca7cf2be3` (round 1, PR #306, is live)
- **Branch:** `claude/nifty-mayer-86n696`

## Where the task comes from

After round 1 the owner asked what else to improve visually; six items were offered. Owner,
2026-11-22: «Сделай все кроме 1. Сразу в прод» — items 2–6, without item 1 (progress bars and
numbers), merged to `master` without asking again. The clipped Select list noticed on a
screenshot is looked at as well.

## What the code looks like (recon)

- Placeholders are `Skeleton` (`.skeleton-shimmer`), a few `animate-pulse` blocks and
  `loading.tsx` / `RouteSkeleton`; content replaces them at once.
- 26 files outside `ui/` build a window by hand (`role="dialog"`); they are mounted
  conditionally, so they vanish at once when closed. The role sits on the card or on the
  full-screen wrapper, some are portalled — there is no shared component to change.
- 37 journal document clients draw their own tables; 74 files save through `fetch` to the journal
  API on their own. There is no shared «row added» or «saved» signal.
- 58 places have a solid chosen chip next to white idle chips; most are multi-choice (weekdays,
  journals, points). Single-choice filter rows are few; some are `Link`s without any `aria-*`.
- The mobile cards view of journals (`RecordCardsView`, 31 journals) and several tables show an
  empty state as one grey line (the cards view — in a dashed box).

## Acceptance criteria

- **AC1 — content after a placeholder.** When a placeholder (`.skeleton-shimmer`,
  `.animate-pulse`) is replaced by content in the same parent, the incoming elements appear one
  after another: opacity, plus a short rise where the element holds nothing fixed; at most six
  steps of 45 ms, each ≤ 0.35 s. A page that arrives without a placeholder is not animated.
- **AC2 — a new row.** A row added alone to a table body that was already on the screen — or an
  item added alone to a list marked `data-motion-list` (the journal cards view on a phone) —
  fades in and carries a tint that fades away in about 1.6 s. A bulk load, a reorder, a filter
  change (several rows at once, or rows replaced) does not.
- **AC3 — a saved mark.** After a successful (2xx) non-GET request to the journal API the table
  cell the person touched last shows a small check for about 1.4 s. Nothing is shown after a
  failed request, a GET, or when no cell was touched. The check is a status colour (success).
- **AC4 — hand-built windows close.** A hand-built window that is removed plays out instead of
  vanishing: on a computer the card fades and shrinks to 0.97 (≤ 0.18 s), on a phone a sheet
  slides down (≤ 0.24 s), the backdrop fades. The copy that plays out takes no clicks and no
  focus. Radix and vaul layers are untouched; a window replaced by another one in the same
  update does not play out.
- **AC5 — pull down on a phone.** Under 640 px a hand-built sheet (rounded top, pinned to the
  bottom) can be pulled down by its top 72 px: past 90 px it closes through its own close button,
  short of that it springs back. A sheet with no close button cannot be closed this way. Such
  sheets show a handle bar at the top.
- **AC6 — segments.** Shared segment styles (`ui/segment-styles.ts`): one soft track, idle
  items without a fill, the chosen one a light pill. Converted: `ChoicePills`, the sort and the
  filter of «Идеи», the filters of «Партии», the tabs of «ЭДО», the tabs of «Продукты», the
  periods of the label log. In each the chosen pill flows to the new item (round 1 mechanism);
  `Link` filters carry `aria-current`. Multi-choice chips and choice buttons inside forms stay.
- **AC7 — empty states.** The journal cards view and the journal tables that showed one grey
  line show an icon and the same text, in a plain veil box (no dashed border) on the screen;
  the printed sheet is unchanged. No new texts.
- **AC8 — the Select list in «Добавление новой строки».** The clipped bottom edge is reproduced
  or ruled out; a real defect is fixed.
- **AC9 — restraint and off switches.** As in round 1: no overshoot above 5 %, nothing on hover,
  no glow, gradient, `will-change`; `data-view-still` / `prefers-reduced-motion` switch all of it
  off (the saved check then appears and disappears without motion). The page looks the same at
  rest except AC6 and AC7.
- **AC10 — checks.** `npm run typecheck`, `npm run test:gate`, ESLint on changed files; tests for
  the new pure functions and guards; Playwright measurements on a computer and a phone, light and
  dark; round 1 measurements still pass.

## Calls made here (not the owner's)

- AC4 and AC5 are done in the runtime for every hand-built window instead of rewriting 26
  components onto the `Dialog` primitive: one mechanism, no component changes.
- AC3 learns about a save from the response of the journal API (a thin wrapper around
  `window.fetch` that returns the original promise untouched): the only signal all journals share.
- AC6 covers page-level single-choice rows and the shared `ChoicePills`. Choice buttons inside
  forms (two or three options next to a field) are left as they are.

## Out of scope

- Item 1 of the list (progress bars, numbers).
- Rewriting journal clients; an «add the first record» button in empty tables (each journal opens
  its own window — no shared handler).
- The video from the original prompt.

## Verification

Builder evidence under `.agent/tasks/site-motion-round2-2026-11-22/`, then a fresh pass on the
branch head (`verdict.json`). The deploy changes no data.
