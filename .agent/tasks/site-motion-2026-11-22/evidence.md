# Evidence — site-motion-2026-11-22

Builder evidence for `spec.md`. Raw artifacts are in `raw/`.

## What was built

| Piece | Where |
|---|---|
| Motion layer: press, fields, toggle, check mark, loading button, liquid shape, hand-built windows, off switches | `src/app/motion.css` (imported after `app-theme.css` in `src/app/layout.tsx`) |
| Runtime: liquid selection, knob stretch, check mark, tab panel, page fade | `src/components/motion/motion-runtime.tsx` (mounted in the root layout), pure part in `motion-model.ts` |
| Theme-switch rule no longer overrides elements with their own motion class | `src/app/app-theme.css` |
| Menus, Select, Popover, Tooltip, Dialog: spring in, faster out; Select chevron turns | `src/components/ui/menu-styles.ts`, `dialog.tsx`, `tooltip.tsx`, `select.tsx` |
| Page area marked for the route fade | `src/components/layout/section-frame.tsx` |
| Mini App on the same springs | `src/app/mini/mini-theme.css` |
| QR form of a journal (standalone HTML) on the same springs | `src/lib/qr-motion-css.ts`, `src/lib/journal-fill-html.ts` |
| QR success mark without the overshooting curve | `src/app/globals.css` (`.qr-success-pop`) |
| Spring tokens: `cubic-bezier` fallback, the real springs under `@supports` | `src/app/globals.css`, `src/lib/qr-motion-css.ts` |
| Generated border layer refreshed (it embeds the file count of `src/`) | `src/app/borderless.css` |

A finding along the way: public pages carry `.app-shell` on `<body>`, so the cabinet's theme-switch
rule (`.app-shell *`) had been overriding the landing's own transitions of 2026-11-18 (button →
loader → check, the knob, the contacts button). They are alive now (`AC1.landing-keeps-own-motion`).

## Checks

| Check | Result | Artifact |
|---|---|---|
| `npm run typecheck` | exit 0 | `raw/typecheck.txt` |
| `npm run test:gate` (targeted, 10 files) | pass 95, fail 0 | `raw/test-gate.txt` |
| New tests (`src/app/motion.test.ts`, `src/components/motion/motion-model.test.ts`) | 31 / 31 | `raw/unit-tests.txt` |
| Design guards and every test that reads the touched files (26 files + `src/app/*.test.ts`) | 289 / 289 | run in the session |
| ESLint on the 12 changed `.ts` / `.tsx` files | 0 errors, 0 warnings | `raw/eslint.txt` |
| Browser measurements (Playwright, local app + local PostgreSQL) | 46 / 46, twice: builder run and the verification run on the final commit | `raw/measure.json`, `raw/verify-measure.json`, script `raw/measure.cjs` |
| At rest before vs after, 17 screens, pixel diff | 13 identical, 3 with 1–3 px of noise, the landing differs only on the animated gold seal | `raw/rest-compare.json` |
| Production minifier (cssnano-simple) on `motion.css` | 49 rules / 92 declarations / 5 keyframes in and out | `raw/prod-minify.json`, script `raw/prod-minify.cjs` |
| Crawl: 24 cabinet pages × desktop and phone, clicking tabs and segments | no page errors, no console errors, no leftover shapes or masks | `raw/verify-crawl.txt` |
| `next build --webpack` into a separate directory | exit 0; the layer's rules are in the built CSS and its chunk loads after the `app-theme` chunk (same chunk order as on the live site) | run in the session |

## Acceptance criteria

- **AC1 — PASS.** `motion.css` is imported after `app-theme.css`, `MotionRuntime` is in the root
  layout (`motion.test.ts`). Measured on the cabinet (classic / «Новая», light / dark), the Mini App
  shell, the QR form, `/login` and the landing: `AC2.press.*`, `AC6.liquid.*`, `AC9.*`, `AC1.login`,
  `AC1.landing-keeps-own-motion`.
- **AC2 — PASS.** Held scale: icon button 0.919 (target 0.92), row 0.985, ordinary control 0.970;
  release returns to 1 with a peak of 1.001. Disabled control and drag handle: `none`. A button held
  inside a card: the card stays `none`, the button 0.970. Tap highlight transparent. A hovered
  button: scale / translate / rotate `none`.
- **AC3 — PASS.** Ring spread while entering a field: 1.2 → 2.7 → 3.6 → 4.0 → 4.06 → 4.0 px (spring,
  +1.5 % at the peak); caret `rgb(85, 102, 246)`; placeholder opacity 0.6 in focus; a bordered field
  without a focus style gets `0 0 0 4px`, the same field inside a table gets none.
- **AC4 — PASS.** Hand-rolled switch in the cabinet: knob 1.18 × while held, 1.32 × at the peak of
  the flight, 2.4 px inside the track at the closest, back to 1; `translate` 0.46 s on the soft
  spring. `Switch` primitive (journal document): same numbers, 1.6 px inside the track.
- **AC5 — PASS.** No `data-ticked` on load (44 boxes on the page); after a click the mark's
  dash offset goes 24 → 0 over 32 frames, the attribute is removed; the box squeezes to 0.919.
- **AC6 — PASS.** Top menu row (underline), sidebar rows, «Новая» menu tree (light and dark),
  segmented control, Mini App bottom bar: the leading edge is at 72–86 % of its way after 110 ms,
  the trailing one at 21–30 %; nothing is left on the group after landing. Synthetic groups:
  `aria-pressed` flows, a change mid-flight retargets one shape, a grid cell on another row and
  column / opaque chips / `data-liquid="off"` are left alone, inline styles are restored.
- **AC7 — PASS.** Dropdown: `enter` 0.3 s on `linear(…)` with blur at the start, `exit` 0.1 s.
  `Dialog` primitive: `enter` 0.3 s on the spring. Hand-built window: card `motion-window-in`
  (opacity 0.27, scale 0.97 on the first frame → `none`), wrapper `motion-fade-in`. Phone: sheet top
  578 → 297 → 40 px, never above its resting place.
- **AC8 — PASS.** After a navigation the page area has one animation, 220 ms, keyframes `opacity`
  only; none on first load. The panel of a chosen tab: opacity + filter + translate, 420 ms.
- **AC9 — PASS.** Mini App: bottom-bar fill flows (`rgb(85, 102, 246)`), a tab squeezes to 0.970,
  `.mini-input` ring 1.2 → 4.06 → 4.0 px. QR form: `.item` squeezes to 0.985, `--spring` is declared
  on the page; `.qr-success-pop` uses `var(--spring)`.
- **AC10 — PASS.** `motion.test.ts`: spring peaks 1.015 / 1.0015 / 1.0457 (≤ 5 %), the layer and
  the runtime have no `will-change`, gradient, `:hover`, lively spring or out-of-range bezier.
  At rest 17 screens are unchanged (`raw/rest-compare.json`).
- **AC11 — PASS.** With the system «Reduce motion»: `data-view-still` is set, a held button stays
  `none`, a tab switch creates no shape, the page area has no animation (`AC11.still`). CSS has the
  `data-view-still`, `prefers-reduced-motion` and print blocks (`motion.test.ts`).
- **AC12 — PASS.** See «Checks».

## Limits

- Measurements run against `next dev` (Turbopack). The production path was checked separately:
  the production minifier drops nothing, and a full `next build --webpack` keeps the layer's rules
  in the right order.
- Browsers without `linear()` easing (Safari before 17.2: an iPhone 8 or X on iOS 16) were not
  available. For them the spring tokens now carry a `cubic-bezier` value and the real springs sit
  under `@supports` (`globals.css`, the QR form); both survive the production CSS build.
- Touch input is emulated (iPhone 13 profile, mouse events): the squeeze under a real finger and the
  swipe of a sheet were not reproduced on a device.
- The Radix `Tabs` panel swap was measured on a synthetic tab group with `aria-controls` (the two
  screens that use `Tabs` need journal data the local database does not have).
