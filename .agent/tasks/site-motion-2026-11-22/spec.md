# Site-wide motion: press, fields, toggles, tabs, menus, windows — cabinet, Mini App, QR pages

- **Task ID:** `site-motion-2026-11-22`
- **Frozen:** 2026-11-22, before implementation
- **Base:** `origin/master` `10f087f8f`
- **Branch:** `claude/nifty-mayer-86n696`

## Where the task comes from

Owner, 2026-11-22: motion design across the whole site, phone included — switching tabs,
buttons, tapping text fields «so that typing is nicer», toggles, menus, «everything», in every
design, for managers and for employees who scan QR codes; «as cool as possible». The message
carries the same motion prompt as on 2026-11-18 (one shape, springs with a tiny overshoot at
most, content swaps through a short blur, a liquid tab indicator whose edges ride different
springs, a toggle knob that stretches; banned: bouncy easing, particles, glows, gradients on UI
chrome, dead time).

The prompt is written for a video. As in `landing-mobile-polish-2026-11-18` (AC13, landing only),
its motion language is taken and applied to the product; that task left the cabinet and «Новая»
out of scope, this one covers them. No video is made.

## State before the change

- Springs exist as tokens (`--spring`, `--spring-soft`, `--spring-lively` in `globals.css`), the
  landing uses them under `.public-theme`.
- In the cabinet `.app-shell * { transition-property: background-color, border-color, color,
  box-shadow }` (unlayered, `app-theme.css`) overrides every Tailwind `transition-*` utility:
  nothing but colour eases — the switch knob jumps, a press has no feedback, tab fills jump.
- The Mini App root is `.mini-root.app-shell` (same rule applies); QR pages and auth pages have no
  shared root class.

## Acceptance criteria

- **AC1 — one motion layer.** `src/app/motion.css`, imported by the root layout after
  `app-theme.css`, built on the existing spring tokens. It applies in the cabinet (classic and
  «Новая», light and dark), `/root`, `/partner`, `/master`, the Mini App, QR pages
  (`task-fill`, `equipment-fill`, `journal-fill`), auth pages and in portalled layers (windows,
  sheets, menus). Elements that carry their own `motion-*` class (landing) keep their rules.
- **AC2 — press.** Every button-like control (`button`, `role=button|tab|switch|menuitem|option|
  radio|checkbox`, `summary`, links styled as buttons or cards) squeezes while pressed and springs
  back: icon buttons to 0.92, ordinary controls to 0.97, wide rows and cards to 0.985. Disabled
  controls and drag handles do not react; a control inside a pressed card squeezes alone. The grey
  tap flash on phones is off. No motion is added on hover.
- **AC3 — fields.** `input` (text-like), `textarea`, `select`, the Select trigger and `.mini-input`:
  the focus ring blooms on a spring (~0.4 s), border and fill ease, the placeholder fades back
  while typing starts, the caret takes the accent. A text field with no focus style of its own
  gets the standard ring (not inside tables and journal grids).
- **AC4 — toggles.** The `Switch` primitive and hand-rolled `role="switch"` buttons: the knob
  travels on a spring, stretches on the way (leading edge ahead of the trailing one) and widens
  while held; the track colour eases. Verified inside `.app-shell`, where the knob used to jump.
- **AC5 — check marks.** `Checkbox`: the box squeezes on press, the mark draws itself when the
  state changes (not on page load); native checkboxes and radios squeeze on press.
- **AC6 — liquid selection.** In exclusive groups the selected fill or underline flows from the
  previous item to the new one, the leading edge faster than the trailing one: `role=tab`
  (hand-rolled and Radix `Tabs`), `aria-pressed` segmented controls, `aria-current` navigation
  (section tabs, the Mini App bottom bar) and sidebar rows (`data-active`). One runtime, no
  per-component code; a change during the flight retargets from the current position. Groups whose
  idle items are opaque, or whose selected state shows nothing on the item itself, stay as they
  are. Opt-out: `data-liquid="off"` on the group or above it.
- **AC7 — menus and windows.** Dropdown menu, Select list, Popover and Tooltip open from their
  trigger on a spring (scale 0.96 → 1 through a short blur) and close faster than they open. A
  dialog springs in on desktop; on a phone it rises as a sheet on the soft spring (no overshoot
  past the edge). The backdrop fades.
- **AC8 — page and panel swap.** On a route change in the cabinet the page area fades in
  (opacity only, ≤ 0.25 s — no transform or filter on the page container, fixed bars stay in
  place); the first load is not animated. A Radix tab panel arrives through a short blur.
- **AC9 — employee screens.** Mini App: the bottom-bar fill flows between tabs, rows and buttons
  squeeze on the spring, the `.mini-input` ring blooms. QR pages: AC2 and AC3 apply; the success
  mark no longer uses an overshooting curve.
- **AC10 — restraint.** In the new layer and runtime: no easing that overshoots more than 5 %,
  no glow, gradient or particles, nothing that moves on hover, no `will-change`. Nothing changes
  at rest: the classic and the «Новая» look are the same until the person interacts.
- **AC11 — off switches.** With `data-view-still` on `<html>` («Без анимации» or the system
  «Reduce motion») and under `prefers-reduced-motion: reduce`: no squeeze, no keyframes of the
  layer, the runtime does nothing. Print is unaffected.
- **AC12 — checks.** `npm run typecheck` and `npm run test:gate` are green; ESLint has no errors
  in changed files; new tests: a guard for `motion.css` (AC1, AC10, AC11) and unit tests for the
  runtime's pure functions (AC6). Browser pass with Playwright on a phone (390 px) and a desktop,
  light and dark, classic and «Новая»: computed styles and mid-animation frames for AC2–AC9.

## Out of scope

- The video from the prompt (sound, Playwright render, ffmpeg) and the Geist font.
- Rewriting hand-rolled controls into shared primitives; new UI texts (none are added).
- The landing's own motion (`.public-theme` rules of 2026-11-18) — it is left as it is.
- Reviving Tailwind `transition-all` in the cabinet (layout properties): only what the criteria
  above name.
- Schema, API, navigation structure.

## Verification

Builder evidence under `.agent/tasks/site-motion-2026-11-22/` (`evidence.md`, `evidence.json`,
`raw/`), then a fresh verification pass on the branch head (`verdict.json`); non-PASS →
`problems.md`, smallest fix, re-verify. The deploy changes no data: CSS, one client module and
primitive class names only.
