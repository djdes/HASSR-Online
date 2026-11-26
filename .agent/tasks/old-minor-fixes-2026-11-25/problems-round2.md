# Problems — old-minor-fixes-2026-11-25, round 2 (fresh verification, 2026-11-25T22:15Z, HEAD 1855c0269)

Verdict: **FAIL** — AC1–AC7 and AC9 pass; AC8 fails on one blocking problem (P1). Both round-1 findings were
re-checked: the malformed `ids` body is fixed (400, rows intact); the mid-word cuts on phones are fixed for the
names of the round-1 repro (seed «Кафе «Ромашка»», «Производственный цех №2», all 31 real cards), but the same
defect remains for names that **end** in a long word. Everything else (DELETE rule, move from a future day, PPK
codes and their translation, ESLint, proxy test, accessibility, ≥640 px layout, desktop hover) passed on the stand
and in commands; see `verdict.json` and `raw/verifier-round2/`.

## P1 (blocking, AC8) — the last word of a name is cut mid-word on phones

**What.** On 320–639 px the pin is glued to the **last character** of the name
(`buildings-client.tsx:371` `splitForPin`, `:689` `<span className="whitespace-nowrap">{nameTail}<PinButton …/>`).
On phones the pin is a 48 px touch box (`app-theme.css:1540`) plus `ml-1`, so the unbreakable unit at the end of
the name is «last word + 52 px». When the last word fits on a line by itself but not together with the pin, Chrome
makes an emergency break inside the word (`break-words` on the `<h2>`): the last letter — or the closing quote —
goes to the next line with the pin. Origin/master's markup kept these words whole (it put the pin alone on the
next line instead, the old V10 note).

Measured on the stand (`raw/verifier-round2/stand/ac8-summary.txt`; branch vs origin/master markup rebuilt in the same
page with master's exact elements and classes; words wider than the whole line, which both layouts cut, excluded):

| width (line) | cut on the branch, whole on master |
|---|---|
| 320 px (170 px) | «Цех кондитерский» → `Цех / кондитерски / й 📎`, «Цех заготовочный», «Цех производственный», «Кафе «Шоколадница»» → `Кафе / «Шоколадница / » 📎`, «Магазин «Перекрёсток»», «Пекарня «Хлебосольная»», «Кафе «Кофемания»» |
| 360 px (210 px) | «Цех производственный» → `Цех / производственны / й 📎`, «Склад продовольственный», «Столовая общеобразовательная» |
| 375 px (225 px) | «Склад продовольственный», «Столовая общеобразовательная» |
| 390 px (240 px) | «Столовая общеобразовательная» → `Столовая / общеобразовательна / я 📎` |
| 480 / 639 px | a 27-letter and a 45-letter single word that fit the line alone |

The band is «line − 52 px < last word ≤ line»: at 320 px every final word of ≈ 11–16 letters (typical quoted
brand names), at 360 px ≈ 15–19 letters. No name among the 31 real cards of the demo org ends in such a word, and
nothing overflows (0 cases), the pin is always on the line of the last character, one focusable pin per card.

The builder's evidence did not catch it: `raw/stand/card-pin-measure.mjs:55` (and the round-1 probe it reused,
`ac8-typical-names.mjs:23`) measure words in `h2.firstChild` only — with the round-2 markup that is the name
**without** its last character, so `кондитерски | й` reads as an unbroken word; and none of the probed names ends in a
long word.

**Repro.** `npx next dev -p 3000`; as `admin@haccp.local` create a point «Цех кондитерский» (or «Кафе «Шоколадница»»),
open `/settings/buildings` at 320×900 → `кондитерски / й 📎`; «Цех производственный» at 360×900; «Столовая
общеобразовательная» at 390×900. Scripted (env loaded):
`node .agent/tasks/old-minor-fixes-2026-11-25/raw/verifier-round2/stand/ac8-names.mjs <outdir>` — creates and deletes
its own points, prints cut words per width for the branch and for master's markup. Screenshots:
`raw/verifier-round2/stand/screens/ac8-320-Цех-кондитерский-{branch,master-sim}.png`,
`ac8-320-Кафе-Шоколадница--{branch,master-sim}.png`, `ac8-360-Цех-производственный-branch.png`,
`ac8-390-Столовая-общеобразовател-{branch,master-sim}.png`.

**Why there is a trade-off.** With a 48 px pin, when «last word + pin» is wider than the line, only three things
are possible: cut the word (now), overflow, or put the pin on its own line. The least bad is the last: a cut word is
the defect round 1 blocked on; a pin alone was the non-blocking V10 note — and it would now happen only in this band
instead of for every long name as on master.

**Smallest fix (checked in the page, `raw/verifier-round2/stand/ac8-fix-experiment.txt`).** Glue the pin to the last
**word** inside an inline-block that may not exceed the line:

```tsx
export function splitForPin(name: string): [string, string] {
  const trimmed = name.trimEnd();
  const at = trimmed.search(/\S+$/);
  return [trimmed.slice(0, at), trimmed.slice(at)];
}
…
{nameHead}
<span className="inline-block max-w-full">{nameTail}<PinButton … className="ml-1 align-middle sm:hidden" /></span>
```

Rebuilt that way on the same 12 probe names × 8 widths (320–639 px): 0 avoidable cuts (only words wider than the whole line are
cut, as on master), 0 overflow; the pin drops to its own line only when «last word + pin» does not fit one line
(13 of 96 probe cases, all names chosen to hit the band). Optional: on phones give the pin a smaller layout box
and keep the 48 px hit area with an absolutely positioned `::after` (the pattern `app-theme.css` already uses for
checkboxes, with `data-touch-compact`) — that halves the band (6 of 96) and removes the 48 px-tall last line.
Then update `buildings-card-layout.test.ts` to the new markup and measure words with ranges across **all** text
nodes of the `<h2>`, with names that end in a long word / a long quoted brand at 320–430 px.

## Non-blocking notes (no change required for this task)

- `splitForPin` splits by code points, not grapheme clusters: «Шеф 👨‍🍳», «Россия 🇷🇺», «Пекарня ❤️» and a decomposed «й»
  are split inside the cluster across two elements. Chrome shapes across the boundary and renders them correctly
  (screens `ac8-390-Россия--branch.png`, `ac8-390-Цех-мяснои--branch.png`); WebKit (all iPhone browsers) is not
  installed here and was not checked. With the last-word split above this goes away.
- `aria-label` on the `<h2>` gives the heading the right name and Chrome keeps the pin inside it in the
  accessibility tree (Tab, Enter and click work, one focus stop per width). Some screen readers in browse mode read
  only the label of a labelled heading; the pin stays reachable by Tab.
- Pre-existing, unchanged: `DELETE …/entries` with the JSON body `null` → TypeError → 500 (master the same);
  the automation lock's «today» in UTC vs the window in the org timezone (round-1 note, `closed-day.ts` untouched).
- Stand hygiene (not product): the builder's runs left three org-wide hygiene documents «Гигиена мелочи …» (Nov 1–30,
  `buildingId` NULL after their points were deleted — `JournalDocument.building` is `onDelete: SetNull`). They show on
  every point of the demo org and make a new November hygiene document at any point a 409 «За этот период уже есть
  документ»; both demo users' `lastActiveBuildingId` still points at a deleted point. Left as found; all verifier
  changes were removed or restored (DB snapshot before/after identical).
