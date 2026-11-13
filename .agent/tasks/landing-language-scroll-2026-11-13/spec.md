# Landing language menu scroll regression

Status: FROZEN before implementation, 2026-11-13.

## Request

«проблемы с лендингом - при открытии дропдауна с сменой языка вся старница дергается а так же когда он открыт то страница не скролится, так же если спущусть ниже и нажму на смену языка шапка вообще исчезнет»

## Scope and assumptions

Fix the shared public language switch, used by the landing and public header. Preserve the existing design system, locale availability, URLs, cookies, keyboard controls, and default behavior of other dropdown menus. The language selector is a non-modal navigation menu; it must allow interaction with the surrounding page. No database, dependency, translation, or unrelated dispatcher changes.

## Acceptance criteria

- AC1: Opening and closing the language menu at the top and after scrolling does not change the page scroll offset, content horizontal position, or viewport content width; no body scroll lock is applied.
- AC2: With the language menu open, the page still scrolls using wheel input; the header remains visible and the menu remains anchored to its trigger.
- AC3: Opening the language menu after scrolling keeps the sticky header in the viewport, on desktop and mobile viewports.
- AC4: The menu supports opening from the keyboard, navigation between language links, Escape to close with focus returned to the trigger, and outside click dismissal. Language links and their remembered choice behavior remain intact.
- AC5: The minimal implementation passes relevant lint, typecheck, and the repository test gate; a fresh pass reruns checks against current code and records a verdict per criterion.

## Verification plan

Inspect the current menu and sticky header CSS. Use a local browser runtime with the actual LanguageSwitch and the relevant page styles to measure layout, scroll offset, body lock, sticky header bounds, wheel scrolling, keyboard behavior, and language navigation on desktop/mobile. Prefer the full landing if its runtime dependencies are locally available; otherwise record any bounded fixture and its limits. Demonstrate that the regression check fails on the original implementation and passes on the fix. Keep raw results, scripts, evidence.md, evidence.json, and a fresh verifier verdict in this task directory. Run targeted ESLint, npm run typecheck, and npm run test:gate; do not change or suppress unrelated failures.

## Delivery

Use a task branch, fetch and integrate origin/master, preserve pre-existing working changes, and deliver via a green, mergeable squash PR to master under the repository's standing authorization. Record any unavailable access honestly.
