# Evidence — landing-mobile-polish-2026-11-18

Verified on 2026-11-18 against the working tree of `claude/brave-cannon-5aodxd`
(base `origin/master` `ca0158e52`): local Postgres 16 + `next dev`, Playwright
Chromium. Raw output is in `raw/`. Screenshots (`raw/*.jpg`) are named below but
are not in git: `.gitignore` excludes images under `.agent/`; they were shown to
the owner in the session.

| AC | Verdict | Proof |
|----|---------|-------|
| AC1 header in one row on a phone | PASS | `raw/m-top.jpg`, `raw/m-authed.jpg`, `raw/sheet-heads.jpg` (en 390 px, uz 360 px, `/pricing` 360 px); `raw/live-checks.txt` §1: ink edges 16…156.3 px = tagline edges 16…156.3 px, `scrollWidth` 390. Language switch: header from `lg` only, footer bottom bar on every width (`public-chrome.tsx`). |
| AC2 first screen on a phone | PASS | `raw/m-top.jpg`: registry mark and H1 centred, price line and guarantee centred, list as a block. |
| AC3 compact consent | PASS | `raw/m-top.jpg`; `raw/live-checks.txt` §3: a real registration wrote `landing \| Принимаю оферту и даю согласие на обработку персональных данных`; test `short legal consent of the start form…` in `src/i18n/localized-components.test.ts`. |
| AC4 no «Не знаете, с чего начать?» on the home page | PASS | `showLiveGuide={false}` on both `HeroEmailStart` in `src/app/page.tsx`; `raw/m-top.jpg`, `raw/sheet-interact.jpg`. |
| AC5 «Разработан при консультации…» as a band | PASS | `raw/m-top.jpg`, `raw/d-top.jpg`. |
| AC6 sphere tiles with icons | PASS | `raw/m-niche.jpg`, `raw/dk-d-niche.jpg`. |
| AC7 one dark contacts button | PASS (counter by code only) | `raw/m-top.jpg`, `raw/d-fab-hover.jpg`, `raw/i-contacts-d.jpg` (chat row inside the window). The unread counter was not exercised live — it needs an operator reply. |
| AC8 «14 дней» once | PASS | `raw/m-price.jpg`; test `public pricing renders four columns…` asserts no trial note under the cards, no «14» in the CTA, tagline and first point, one table footnote. |
| AC9 comparison table | PASS | `raw/m-table.jpg`, `raw/dk-m-table.jpg`, `raw/d-table.jpg`, `raw/sheet-interact.jpg` (tab «ВИП»); test `every comparison row has its own icon`. |
| AC10 compact footer | PASS | `raw/m-footer.jpg`, `raw/d-footer.jpg`. |
| AC11 interlinking | PASS | Footer rows are `nav > ul` with a hub link (`raw/d-footer.jpg`: «Все журналы — 46 →», «Все возможности →»); home passes `omitRows={["niches"]}`; FAQ follow-up links (`raw/sheet-interact.jpg`, frame 7); «Все возможности сервиса» under the capability cards (`raw/m-niche.jpg`, top). |
| AC12 pointer cursor | PASS | `raw/live-checks.txt` §5. |
| AC13 motion language | PASS | `raw/live-checks.txt` §2 (reduced motion), §4 (button → loader 56 px → check); `raw/sheet-interact.jpg`; `raw/d-fab-hover.jpg`. Removed: `cursor-glow.tsx`, CTA shimmer/pulse, chip pop. Intermediate frames of springs were watched in the browser run, not saved as files. |
| AC14 texts and checks | PASS | `raw/typecheck.txt` (exit 0), `raw/test-gate.txt` (71 files, pass 294, fail 0); `npm run i18n:types` ran after the last dictionary edit. |

Note: `raw/m-table.jpg` and `raw/m-footer.jpg` were taken before two small
tweaks (tab widths by content, extra bottom padding under the footer line);
`raw/sheet-interact.jpg` shows the final tabs.
