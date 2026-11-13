# Verification corrections

## V1 — existing organization SSR fixture did not provide correspondence data

- Criterion: AC1/AC6; initial verdict: FAIL by current fixture inspection.
- Reproduction: render the modified organization page with the existing isolated localization fixture. New correspondence history/SMTP imports require mocks, while the fixture only covered existing documents.
- Expected: the real organization page renders and retains its guard and existing content in ru/en/uz.
- Smallest fix: add two data-boundary mocks to `root-organization-management-localization.test.ts` and assert the localized correspondence heading; do not change production behavior.
- Reverification: `raw/focused-final.log` passes all 34 tests, including the actual page in all locales, actual email API handlers, SMTP, idempotency and tenant isolation.

## Local verification infrastructure

The default working copy's dependencies were incomplete. Failed installations were retained in this task, then replaced with read-only junctions to compatible, complete local dependencies. `@prisma/client` and its generated client are private to the task; no other checkout's generated client is changed. Initial default-sandbox long-running checks were interrupted and replaced with authorized fresh checks. The browser fixture uses installed Chrome and a stable textarea selector; the current browser result passes all scenarios. No real client email was sent.

## V2 — global TypeScript verification

- Initial verdict: FAIL. The compiler rejected four direct casts of intentionally partial Prisma delegate mocks; it also found missing pre-existing CRM/SEO dependencies in the reused local environment.
- Smallest source fix: explicitly cast those four mocks through unknown; production code is unchanged.
- Environment fix: install the missing package versions in this task only, link them locally, and isolate the added @types folder; shared dependency files are unchanged.
- Reverification: raw/typecheck-final.log and raw/typecheck-final.exit record npm run typecheck exit 0 after merging current origin/master. ESLint for the corrected test file also exits 0 (raw/lint-test-fix.log).

## V3 — complete baseline gate

- Initial verdict: FAIL. The full suite reported 6149 passes and eight failures (`raw/test-gate-v3-failed.log`); the reproduction log is `raw/full-gate-failures.log`.
- Four failures were literal LF assumptions against CRLF checkout files (security/schema, platform roles/auth helper, and two QR/print source assertions). One publication-plan assertion also needed the tracked document's LF text. Only those five identified files were normalized locally, producing no Git content change. Automatic review rejected an earlier proposal to normalize all tracked text; that broad operation was not run.
- The voice test expected three existing tracked MP3 samples omitted by sparse checkout. Restore only those three unchanged Git artifacts locally.
- The neutral palette generator used URL.pathname as a filesystem path, which fails on Windows drive letters. Smallest source fix: use node:url fileURLToPath. Regenerate the palette using its repository command. New correspondence UI now uses the current neutral palette directly.
- The terminology scanner found five pre-existing visible occurrences outside its permitted exceptions. Change only the reported contract download filename, three Russian contract-template labels and one knowledge-base sentence to template/journal terminology. No test, exception or baseline was weakened.
- Reverification: `raw/reverification-v3.log` passes all 65 tests across the previously failing files and the correspondence/API/page/SMTP tests. `raw/lint-v3.log` has no errors (the repository ignores scripts for ESLint). The current browser rerun passes; full gate is rerun for the final source.

## V4 — generated contract and concurrent test load

- The second full run reported 6160 passes and three failing assertions (`raw/test-gate-v4-failed.log`). The generated translation contract was still stale when its test ran; regenerate it with `npm run i18n:types`, including the three changed Russian contract-template literals. A normal commit then passed all 261 tests in 64 related files (`raw/v3-fix-commit-final.log`).
- The two prewarm assertions passed unchanged in isolation, alongside the generated-contract check: 17/17 (`raw/reverification-v4.log`). The script test has a 30-second child-process limit; the 16-way full run overlapped another 64-file gate and typecheck. The final full run uses the earlier stable eight-process concurrency. No timeout, test or baseline was relaxed.

## Final current-source verification

- The stable full baseline gate passes all 6163 tests with zero failures (`raw/test-gate-final.log`).
- The long 8-GB npm typecheck completed successfully just before the planned restart; it was not killed. The generated message-contract file had changed during that run, so a supplementary identical compiler command with a 16-GB task-local heap checked the final generated version and exited 0 (`raw/typecheck-high-memory.exit`). The normal npm typecheck then repeats against that current cache. No project typechecking option or file selection changed.
- The compiler's source hashes match all 17 changed TypeScript/JSON inputs (`raw/typecheck-source-coherence.json`: PASS). Only proof artifacts are added after this source verification.
