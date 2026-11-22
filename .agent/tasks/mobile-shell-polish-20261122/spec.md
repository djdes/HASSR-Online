# Mobile shell polish: home contacts, objects sheet, object icons, MAX linking, menu, switch toast

Frozen 2026-11-22, before implementation.

Original request (owner, with five phone screenshots of wesetup.ru):

1. On the phone home page keep «Мы на связи» expanded, with no way to collapse it. After sign-in the home page must fit the screen without scrolling; shrink heights as needed; the title row with the icon may go, tabs first.
2. Objects sheet: the word «Объекты» large and bold, the size of the close button; remove the line above the search; the selected object's icon must lose its own background (double fill). Let the object icon be changed in settings to a typical icon from our library, or to the user's own upload.
3. Add a link (chain) mark to the MAX icon, so it reads as «link MAX to my account». Think through linking for users across the site (PIN code or similar) and update the icon everywhere.
4. Left menu: an always-visible scrollbar where appropriate (when expanded and so on).
5. Left menu: remove «Выйти»; pin the last item «Пришла проверка»; it currently looks pressed/active, give it a proper indication.
6. The object-switch toast shows shifted left and often over the menu on the phone, not on free space; position it properly.

Also: test through the environment (real app in a browser), use the relevant skills, apply `benjitaylor/skills` «stageshow» where it fits; modernise without clutter.

Interpretation and limits:

- «Left menu» is the phone menu sheet (`MobileNavSheet`) and the desktop sidebar (classic and «Новая»); both share the accordions.
- Logout stays where it already is: the profile sheet / profile menu (avatar) and the desktop header button.
- Stageshow is a kit for marketing mock-ups, not for live product UI; it is used as a design-review checklist (restraint, even insets, badges inside the content edge, motion with a cause), not as runtime code.
- Project design rules hold: one accent (`one-accent.test.ts`), no neutral box borders (`borderless.test.ts`), new design via `newd:`, every visible string in ru/en/uz plus `npm run i18n:types`.

## Acceptance criteria

- AC1 Home contacts on the phone: `«Мы на связи»` renders open with no toggle button and no `aria-expanded`; below 768px there is no title row (tabs are first); from 768px the small title stays as before. The phone home layout is tightened so that at 390×664 and 430×740 CSS px (owner with 8 objects, 4 support channels) `document.scrollingElement.scrollHeight <= innerHeight` and the last contact row is fully inside the viewport. Desktop (≥1024px) layout unchanged.
- AC2 Bottom sheets: the visible sheet title is bold, ~22px, vertically centred with the 40px close button; no divider line between the sheet header and its body. Objects sheet (phone) and objects dropdown (desktop): the selected object's icon has no background or border of its own (the row tint is the only fill).
- AC3 Object icon: `Building.icon` (nullable) holds a key from a fixed library of typical icons (≥12, Russian labels in all locales) or the URL of an uploaded image. Upload: PNG/JPEG/WebP/SVG (SVG sanitised), ≤ 300 KB, stored in its own table and served from `/api/org-assets/<org>/building-icon/<building>?v=N`, org-scoped, manager-only, audit-logged. The building settings page offers the library grid, «Загрузить свой» and «Как было». The chosen icon shows in the phone objects sheet, the desktop objects dropdown and the current-object chip/bar. Invalid key / foreign building / non-manager are rejected by the API (tested).
- AC4 MAX icon: one `MaxLinkIcon` (MAX mark + a small round chain badge fully inside the icon box) replaces the bare mark wherever the MAX icon means «connect MAX» (dashboard header classic and new, mini-app shell, QR fill shell, «Ещё» page). When the signed-in user is linked the badge shows a check and the title says MAX is linked; otherwise a chain and «Привязать MAX к аккаунту». Labels in ru/en/uz. `/home` is an allowed return path of `/max/connect`.
- AC5 MAX linking by code: on `/max/connect`, a personal link request also shows a 6-digit code («или отправьте боту код …»). An unlinked person who sends exactly that code to the bot in a private chat nominates their MAX account for the request, exactly like the deep link (the site still asks «Это ваш аккаунт MAX?»). Codes are stored hashed, unique among active requests, expire with the request (10 min), and wrong codes are rate-limited per MAX user. Covered by unit tests of the pure parts.
- AC6 Scrollbars: the phone menu sheet and the desktop sidebar (classic and «Новая») show a visible scrollbar whenever the menu is taller than its box (Radix ScrollArea, `type="auto"`), not a hidden one; dragging it does not drag the sheet (`data-vaul-no-drag`).
- AC7 «Пришла проверка»: no «Выйти» row in the menu sheet. «Пришла проверка» stays visible at the bottom of the scrolling menu (sticky) on the phone sheet and the classic desktop sidebar, including while its own sublist is open; the «Новая» desktop keeps its fixed bottom slot. Its look is an emergency action, not a pressed item: no grey veil fill at rest; a status-red shield icon on a light red tint, a hairline in the same status tone; when the person is inside the section, a filled light-red state with `aria-current`. Same in light and dark themes.
- AC8 Switch toast: centred horizontally at every width (no left shift on wide phones); on phones (<600px) it appears at the top edge (`safe-area + 8px`) over the header strip, not 128px down over content or the menu; on tablet/desktop the offset and centring are unchanged.
- AC9 Quality gates: `npm run typecheck`, `npm run lint` on changed files, the targeted/escalated test gate (`node scripts/test-changed.mjs`), locale contract (`i18n:types` up to date), `one-accent`/`borderless`/`neutral-palette` tests green. A real browser pass (Playwright, local Postgres, dev server) captures phone 390×664 and desktop screenshots of home, objects sheet, menu sheet (top and scrolled), settings icon picker, MAX connect page, and the toast, in light and dark; measurements for AC1/AC8 recorded in `raw/`.

## Verification

Builder writes `evidence.md`, `evidence.json` and raw artifacts (screenshots, measurement JSON, command logs) under `.agent/tasks/mobile-shell-polish-20261122/`. A separate fresh verification pass re-reads the current code, re-runs the checks and the browser measurements, and records `verdict.json`; any non-PASS gets `problems.md` and the smallest fix, then re-verification.

Schema change (nullable `Building.icon`, new `BuildingIconFile`, nullable `MaxLinkRequest.codeHash` + index) is additive and safe for `apply-safe-schema`; mention it in the PR. No delegation was requested; one builder, one verifier, in-thread.
