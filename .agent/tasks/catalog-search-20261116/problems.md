# Verification problems and fixes

- Initial checkout was stale (157 commits behind origin/master). Continued implementation in a separate worktree based on current origin/master, retained existing localized journal catalog search, reused current shared matcher, discarded prototype custom matcher and journal-page replacement.
- Initial full gate and typecheck on stale checkout were stopped. Current AGENTS.md requires the targeted gate for ordinary changes; final checks use that gate in the fresh worktree.
- Playwright bundled Chromium is not installed. Interaction verification uses installed Chrome via channel: chrome.
- Fresh interaction run started while npm ci was still extracting dependencies and hit EBUSY. Rerun after installation completes.

- Mandatory full typecheck stalled for over 25 minutes in an existing administrative component. Inspector samples repeatedly located AutosaveStatus at `error ?? t("autosave.error")`. Its unscoped translator return type causes global message-key expansion. Frozen repair scope is in verification-repair-spec.md; the stalled run is stopped and its output preserved before applying the one-line namespace type correction.

- The added metadata/FAQ comparison initially differed only by Windows CRLF versus git blob LF. The comparator now normalizes line endings before comparing AST node text; metadata values and FAQ text are not changed.

- The strengthened metadata assertion caught a stale DESCRIPTION on /prikazy carried from the initial checkout during transfer. Restored the exact current HEAD description; final diff now contains only search integration and the bounded translator declaration fix. Rerun metadata/FAQ comparison and all final checks on this corrected code.

- The first completed full typecheck found public/manifest.json absent from the sparse worktree, causing TS2307 and dependent implicit-any diagnostics. Restored that unchanged tracked file from HEAD using git restore --ignore-skip-worktree-bits; no application change is needed. Rerun the cached full typecheck and all verification checks.
