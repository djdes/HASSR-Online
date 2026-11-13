# Evidence — PASS

Fresh pass: raw/verifier-latest/commands.json and raw/verifier-latest/browser-results.json. Verified base HEAD 1f6ccb0d3284200839d267b2bf9cd0f88dcde496, Node v22.23.5, current lockfile; HEAD and source/lock hashes stayed stable for the whole pass.

Production change: only LanguageSwitch opts into modal={false}. Shared menu defaults and styling remain intact.

- AC1 PASS: open/close preserves scroll offset, horizontal position, viewport and body width. The original mode reduces body width by 15px with visible scrollbars.
- AC2 PASS: wheel input with an open fixed menu advances scrollY from 900 to 1220; its anchor remains 6px below the trigger. Original mode locks body scrolling.
- AC3 PASS: after opening at scrollY=900, original header y=-900; fixed header y=0. Checked 1440×900 and 390×844.
- AC4 PASS: keyboard opening/navigation, Escape/focus restoration, outside dismissal, locale URL query/hash, and both explicit-language cookies.
- AC5 PASS: ESLint, 14 locale unit tests, npm run typecheck, and npm run test:gate all exit 0 in the fresh pass.

The default repository test gate selects tests for changed files and found no connected unit tests for LanguageSwitch; no full unit-suite claim is made. The separate real-component browser regression covers this change.

The browser uses actual LanguageSwitch, Radix, intl and repository CSS. Next routing and landing body are bounded fixtures, not a full production landing E2E. Mobile results are Chromium viewports, not physical devices.

Original dispatcher changes were preserved by using a clean worktree. Exploratory old-lock runs and the intermediate pass overlapping an upstream update are superseded by this stable current-code pass.
