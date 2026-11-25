# Problems — old-minor-fixes-2026-11-25 (fresh verification, 2026-11-25T21:34Z, HEAD 88f837835)

Verdict: **FAIL** — AC1–AC7 and AC9 pass; AC8 fails on one blocking problem. Everything else (codes, DELETE rule,
move from a future day, compare/approve, ESLint, proxy test) passed on the stand and in commands; see `verdict.json`.

## P1 (blocking, AC8) — names are cut mid-word on phones

**What.** On 320–639 px the card header is now one flex row `[icon][name][pin]` (`buildings-client.tsx:666-672`). The pin
is an icon button, and the global touch-target rule gives icon buttons a 48×48 box on phones
(`src/app/app-theme.css:1540`). Icon 16 px + two 8 px gaps + 48 px pin come out of the name's width:

| width | name column on master | name column now |
|------:|----------------------:|----------------:|
| 320 px | 170 px | 90 px |
| 360 px | 210 px | 130 px |
| 375 px | 225 px | 145 px |
| 390 px | 240 px | 160 px |

The name keeps `break-words` (line 668), so every word wider than the column is cut at an arbitrary letter:

- 320 px: the demo seed card «Кафе «Ромашка»» renders `Кафе / «Ромашка / »`; «Поликлиника …» is cut; 19 words split
  across the 35 cards on the page (1 with the previous layout); typical names «Производственный цех №2»,
  «Кондитерский цех», «Центральная кухня», «Столовая «Берёзка»» are all cut (none before).
- 360 / 375 / 390 px (most phones): «Производственный цех №2» renders `Производственны / й цех №2` (intact before).
- 412 / 430 px and wider: no cuts.

AC8 asks that a long name wrap inside the row; cutting ordinary and domain-typical words is a new visible defect in
the same card at the same widths (the previous layout gave the name the full row and cut none of these names).
All structural AC8 conditions themselves hold (one row, sphere below for long names, order from 640 px unchanged,
pin hover-only on desktop).

**Repro.** `npx next dev -p 3000`; as `admin@haccp.local` create a point «Производственный цех №2» (sphere food), open
`/settings/buildings` at 390×900 → `Производственны / й цех №2`; at 320×900 the seed card shows `«Ромашка / »`.
Scripted (env loaded): `node .agent/tasks/old-minor-fixes-2026-11-25/raw/verifier-round1/stand/ac8-typical-names.mjs <outdir>`
prints the split words per width for the branch and for the previous layout (same page, group dissolved with
`[data-building-title]{display:contents}`), creates and deletes its own points. Screenshots:
`raw/verifier-round1/stand/screens/ac8-typical-production-390-branch.png`, `ac8-real-romashka-320-branch.png` vs
`ac8-real-romashka-320-previous-simulated.png`.

**Smallest fix (suggestion).** Keep the pin with the name without giving it its own column next to the text:
on phones let the group be normal text flow instead of a flex row — icon inline, `h2` inline, pin inline right after
the name (optionally the last word and the pin in one `whitespace-nowrap` span, so the pin never starts a line alone).
The name then wraps by words across the whole row, as on master, and the pin follows its last word; with `sm:contents`
the children are blockified flex items again, so 640 px and wider stay exactly as now. Then rerun
`ac8-typical-names.mjs` (expect no split words for those names at 320–430 px, except words longer than the full row,
which master also cut) and `ac8-card-layout.mjs`, and update `buildings-card-layout.test.ts` to the new markup.
(`hyphens-auto` alone would only hyphenate the cut where the browser has a Russian dictionary; it does not give the
name its width back.)

## Non-blocking notes (no change required for this task)

- Short name + short sphere («Кабинет 7», «Медицинские услуги»): at 639 px the chip stays on the name row after the
  pin (below at 320–430 px) — same order as master.
- 640–~700 px, short name + long food chip: the pin starts the second row alone — pre-existing; the spec keeps ≥640 px
  as before.
- `entryDeleteTarget`: `{ ids: [5], employeeId }` (only non-string ids) now means «whole row of the employee» (master:
  500). No client sends it; locks still apply. A non-empty `ids` array without a valid id could return 400.
- Pre-existing, outside the spec: the automation lock counts «today» in UTC (`getStartOfToday`), the window in the
  organization's timezone — 00:00–03:00 MSK the Moscow «yesterday» of an automation document is not locked.
- Stand hygiene: the builder's `raw/stand/minor-fixes-e2e.mjs` leaves its points «Кафе мелочи 20:50:10 / 20:52:47» with
  hygiene documents, and both demo users' active point is one of them (left as found).
