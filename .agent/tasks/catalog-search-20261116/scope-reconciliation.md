# Scope reconciliation against origin/master

The initial checkout was 157 commits behind origin/master. The current master already provides localized /journals-info search and shared journal-search.ts including fuzzy matching. Preserve this implementation; add the shared searchable catalog only to /blanki and /prikazy, using the existing matcher. AC1–AC4 apply to both newly changed pages; existing /journals-info is reviewed for existing coverage. AC5 checks run on the fresh origin/master worktree. The earlier prototype journals-info changes and custom matcher are discarded before delivery.

Initial checks on stale checkout: lint and focused tests passed; full gate/typecheck were stopped to run on current master with bounded test concurrency. Initial interaction run could not launch Playwright bundled Chromium (not installed); rerun uses installed Chrome.
