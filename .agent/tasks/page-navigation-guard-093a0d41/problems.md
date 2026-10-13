# Verification findings

- Fourth browser pass: all five UI/document scenarios PASS. The final background-budget load check hit the local test tunnel's default five-connection backlog (`ECONNREFUSED` under ten simultaneous connections). Increased loopback test queue and reduced request batch size to four. No product source changes; rerun browser harness only.

- Third browser pass: ordinary prefetch/navigation, real RSC rejection, countdown, responsive layout, premature retry and actual cooldown recovery PASS. The no-script hint was not exposed under Chromium's script-execution-disabled mode (its parser retains noscript as text). Make the reload explanation visible by default, and hide it only after the countdown script successfully initializes; this also helps when scripts are blocked independently of parser settings. Reverify.

- Second real browser pass: FAIL. Next 16.1.6 `server/web/adapter.js` removes Flight headers before user proxy; direct NextRequest unit tests cannot reveal that transformation. Frozen revision 2 before fix: use browser Fetch Metadata to select the bounded background budget, with stricter fallback for absent metadata. Rerun required.

- Initial Linux typecheck: two new test-fixture type errors (union headers and application JWT augmentation). Fixed explicit header-array typing and the same test-claims cast used by existing proxy tests.
- First real browser pass: FAIL. Full Link prefetch in Next 16.1.6 omits the prefetch marker and exhausted the document budget on a normal 30-link page. Frozen spec revision 1 before the fix: count all RSC requests in the bounded background budget, not only explicitly marked prefetch. Preserve shared cooldown; retest real Next prefetch/navigation and direct RSC exhaustion. Initial failed browser evidence retained separately.

- Initial local focused pass: 18/19. A new callback test assumed that the existing NextURL rewrite removes `/payment/`'s slash in the response header. Existing behavior retains that slash. No callback code was changed; corrected the assertion to the actual required invariant: HTTP 200 rewrite, no redirect, no page throttle. Rerun required.
- Capacity policy clarification: the normal per-subject block is fixed at 30 seconds. At the hard 5000-subject memory cap, unseen subjects wait until the next periodic sweep (up to 60 seconds) instead of evicting existing budgets. This overload behavior is documented and covered by tests.
