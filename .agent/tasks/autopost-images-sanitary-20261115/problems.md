# Verification findings

P1: The gateway truncates image prompts to their first 8,000 characters (src/lib/codex-gateway.ts). Appending sanitary requirements after an unconstrained model scene could remove the requirements for a long saved description. Fix: place mandatory hygiene and no-text/style requirements before variable topic/scene content; add a regression using the actual 8,000-character transport boundary. Reverify the updated source before delivery.

P2: Initial full typecheck exited 2 because seven unrelated, unchanged files in the reused isolated checkout contain binary/invalid characters (weekday-chips, mercury/process-incoming, mobile-devices.test, newcomer-journey, newcomer-scope and its test, use-body-scroll-lock.test). Preserve the initial log; inspect current bytes against Git HEAD and restore only those named tracked files in the isolated checkout. Do not touch the main worktree's dispatcher edits. Rerun typecheck on the repaired checkout.

P1 fix applied: mandatory sanitary/style/no-text rules precede variable scene content; regression coverage exercises the actual 8,000-character truncation boundary. Focused checks are rerun on the fixed source.

P2 repair applied: ordinary Git restore/checkout-index did not rewrite the corrupted files. Materialized the seven verified HEAD blobs directly in the isolated checkout, then verified their normalized SHA-256 against HEAD. The product diff remains exactly the intended three files. See raw/checkout-repair.json and raw/typecheck-initial.log; the final typecheck result is recorded separately in raw/typecheck.log.
