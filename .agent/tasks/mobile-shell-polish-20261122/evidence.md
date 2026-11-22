# Evidence — mobile shell polish (2026-11-22)

Builder evidence against the frozen `spec.md`. Environment: local PostgreSQL 16, `next dev` on :3000, Playwright Chromium (phone contexts `isMobile`, `hasTouch`, DPR 2). Test org «МАУ "КП "ДК"» with 8 objects named as in the owner's screenshots, owner account, legal version accepted, NPS asked, paid period (so no demo-only banners push the layout). Scripts live in the session scratchpad (`pw/*.cjs`); their outputs are in `raw/`.

## AC1 — home contacts open, phone home fits one screen

- `HomeContacts` (renamed from `HomeContactsSpoiler`): no button, no `aria-expanded`; `aside aria-label` keeps the name for screen readers; the small title shows from 768px only.
- Phone tightening: gaps 12px (`space-y-3`, `gap-3`), logo block `py-2.5` + logo 40px, setup tile `py-2.5`, favourites 72px, contacts card `px-3 py-2.5`, `<main>` `py-2.5` on the phone home, dashboard footer hidden on the phone home only (`globals.css`, ≤767px). Contact rows stay 44px with the existing 8px touch spacing rule.
- Measured (`raw/after-home-measure.json`): 390×664 → scrollHeight 664 = innerHeight, last contact row bottom 633; 430×740 and 360×700 fit; light/dark × classic/«Новая» at 390×664 identical geometry. Before: 682 > 664 with contacts open (`raw/before-home-*.png`, first pass).
- Screens: `raw/after-home-{classic,new}-{light,dark}-390x664.png`, `after-home-classic-light-{430x740,360x700}.png`.

## AC2 — bottom sheet header, selected object icon

- `BottomSheet`: title 22px / 700 / `leading-10`, `items-center` with the close button (40px, 48px under the global touch rule); no `border-t` under the header (`data-sheet-body`).
- Selected object row: icon without own fill/border (`bg-transparent`), idle rows keep the soft box.
- Measured (`raw/after-objects-measure.json`): title 22px/700, centre delta to close = 0, body border-top 0px, active icon background `rgba(0,0,0,0)` border 0px — light, dark, classic, «Новая».
- Screens: `raw/after-objects-sheet-*-390x664.png`, desktop dropdown `raw/after-objects-dropdown-1280.png`.

## AC3 — object icon (library or own upload)

- Schema: `Building.icon String?`, `BuildingIconFile` (PNG/SVG bytes, version). Library of 20 typical icons (`lib/building-icons.ts`) with labels in ru/en/uz.
- API `PUT/POST /api/settings/buildings/[id]/icon` (manager, own org, point-scope, Zod, audit log); serving `/api/org-assets/<org>/building-icon/<id>?v=N` (org-checked, sandbox CSP, nosniff). Browser converts raster to 128px PNG; server accepts PNG/SVG (SVG sanitised), ≤300 KB.
- UI: «Значок объекта» row on the object page with dialog (library grid, «Загрузить свой», «Как было»). Icons shown in the phone sheet, desktop dropdown, current-object chip/bar.
- End to end in the browser (`raw/after-objects-measure.json` → `api`): library 200, unknown key 400, foreign building 404, upload 200, served `image/png` with sandbox CSP; UI choice «Столовая» applied and visible in the header dropdown (`dropdownIcons`).
- Tests: `src/lib/building-icons.test.ts`, `src/app/api/settings/buildings/[id]/icon/route.test.ts` (non-manager 403, foreign 404, out of scope 403, bad key 400, text 415, >300 KB 413, empty 400).
- Screens: `raw/after-settings-icon-{row,dialog}-1280.png`, `raw/after-settings-icon-dialog-390x664.png`.

## AC4 — MAX icon with link badge

- `MaxLinkIcon`: official MAX mark + round badge (chain when not linked, green check when linked) inside the 40px button, separated by a surface-coloured ring. Used in the dashboard header (classic, «Новая»), mini-app shell, QR fill shell, «Ещё» page. Bare mark kept where MAX is only a contact channel.
- Header knows the state: dashboard layout loads `MaxIdentity` → `maxLinked`. Labels `sharedUi.maxLink.connect|linked` in ru/en/uz. `/home` added to `safeMaxReturnPath`.
- Browser (`raw/after-max-flow.json`): before linking `data-max-connect="unlinked"`, label «Привязать MAX к аккаунту», href `/max/connect?next=%2Fhome`; after confirming → `linked`, «MAX привязан к аккаунту». Screens `raw/after-max-header-{unlinked,linked}-390x664.png`, `after-max-header-{new-light,classic-dark}-1280.png`.

## AC5 — MAX linking by 6-digit code

- `createMaxLink` (personal) also issues a 6-digit code, unique among active requests, stored as SHA-256 only (`MaxLinkRequest.codeHash`, indexed). Bot: an unlinked person sending exactly the code (spaces/dash allowed) nominates their MAX account like the deep link; site confirmation unchanged. Guessing limited to 5 attempts / 15 min per MAX user.
- `/max/connect` shows the code with copy button and hint (i18n).
- Browser E2E with dummy local MAX settings: code shown (6 digits), wrong code from another MAX user does not nominate, right code («482 913» form) → site shows «Это ваш аккаунт MAX?» with the sender's name → confirm → linked. The webhook answered 503 only because the bot's reply cannot reach the real MAX API from the sandbox; the nomination is stored before the reply.
- Tests: `src/lib/max/link-code.test.ts` (generation/parse/hash, unique code, only hash stored, claim where-clause, unknown code 400, 6th guess 429), `src/components/max/max-link-icon.test.ts`.

## AC6 — visible scrollbar in menus

- `ScrollPane` (Radix ScrollArea `type="auto"`, `data-vaul-no-drag`) in the phone menu sheet (`BottomSheet scrollbar`), classic desktop sidebar and «Новая» sidebar (replacing the hidden scrollbar and arrow buttons).
- Measured (`raw/after-menu-measure.json`): sheet with expanded sections scrollH 456 > clientH 398 → bar visible (390px); short menu → no bar; «Новая» desktop 1379 > 513 → bar visible; classic desktop fits → no bar.
- Found and fixed while testing: focus/scroll-into-view shifted the whole sheet up (vaul `::after` makes the `overflow:hidden` card scrollable) → `overflow-clip`; re-measured scrollTop 0.

## AC7 — no «Выйти», pinned «Пришла проверка»

- Menu sheet has no logout (`logout:false` in all four combinations); logout remains in the profile sheet/menu and the desktop header.
- Dock `sticky top-0 bottom-0`: pinned at the bottom over a long menu, and at the top while its own sublist is scrolled (inside the section: dock bottom 613 at top of list, 333 when scrolled to the end — always in view).
- Style: rest — transparent, hairline in `--app-warn-fg` 24%, shield in the warning tone; inside the section — `--app-warn-bg` fill, warning text, `aria-current`. Values exist for dark theme (`rgb(242,243,251)` text, warning hairline in dark measured).
- Screens: `raw/after-menu-sheet-{top,expanded}-*-390x664.png`, `after-menu-sheet-inspection-{top,end}-390x664.png`, `after-desktop-sidebar-*-1440x760.png`.

## AC8 — switch toast placement

- Cause of the left shift: global phone rule gives sonner's container 8px gutters while sonner sizes the toast `100% − 32px` and aligns it left → 8px left / 40px right. Fixed (`[data-sonner-toaster] [data-sonner-toast] { width: 100% }` in that rule); card `mx-auto w-full max-w-[360px]`, full width under 600px; desktop custom toast fills the 400px column so the card centres (`.dashboard-toaster [data-sonner-toast]`).
- Phone offset `calc(env(safe-area-inset-top) + 8px)` instead of 128px.
- Measured (`raw/after-toast-measure.json`): 390 → top 8, left 8, right 8; 430 → top 8, left 8, right 8; 1440 desktop → top 84, card centre 848 = content-column centre.

## AC9 — checks

See `evidence.json` for command results (typecheck, ESLint on changed files, targeted tests, gate, design guards, i18n contract).

## Stageshow

`benjitaylor/skills` «stageshow» was installed (`npx skills add benjitaylor/skills --skill stageshow`, `skills-lock.json`). It is a kit for marketing mock-ups, not live UI, so it served as a review checklist: badge fully inside the control (MAX badge within the 40px button), even 12px insets (contacts card, toast), restraint (no new hues, gradients or motion; status tone only for the emergency action), one signal said once (check mark only when linked).
