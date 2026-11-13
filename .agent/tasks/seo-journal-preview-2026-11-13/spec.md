# Public journal landing preview

Status: FROZEN before implementation, 2026-11-13.

## Request

Show the actual journal sample on `/zhurnal-uborki`, directly after the introductory hero. Reuse the preview already used by `/journals-info/cleaning` rather than inventing another journal layout.

## Scope

- Reuse `JournalScreenshot` in the shared `SeoJournalLanding` template for its existing supported sample codes.
- Label the preview as demonstration data. Keep unsupported landings free of empty preview placeholders.
- Enable horizontal scrolling of the existing cleaning matrix on small screens.
- Preserve the current registration CTA, PDF download/email flow, content, and journal-card preview.
- No database, authentication, PDF-generation, translations, or deployment configuration changes.

## Acceptance criteria

- **AC1:** `/zhurnal-uborki` renders a visible sample between its hero and required-fields section. The reused cleaning preview contains its four room rows, daily marks and legend, and the surrounding text explicitly identifies demonstration data.
- **AC2:** Shared landings with an existing supported sample render the matching preview; landings without a supported sample render no preview section. Existing static sample assets load successfully on desktop and mobile.
- **AC3:** At 320, 375, 768 and 1440 px viewport widths the cleaning page has no horizontal document overflow. On narrow screens its table can scroll horizontally through actual user input, while the page can still scroll vertically. The sample can be read without logging in or accessing the database.
- **AC4:** Registration still targets `/register`; cleaning downloads still use the existing `BlankDownloadButton` PDF code and attribution. Custom download links and unsupported-page PDF fallback remain unchanged. The existing journal-card cleaning preview remains usable.
- **AC5:** Targeted ESLint, repository typecheck and changed-test gate pass against the final source. A fresh verification reruns the browser checks and required commands with a stable repository HEAD and unchanged frozen spec.

## Evidence and verification

Keep scripts, raw command logs, browser measurements and screenshots in this task directory. Render the real landing template and preview in a bounded browser fixture with only unrelated public chrome and framework/download boundaries stubbed. Check all landing configurations, static asset loading, responsive layout and real scroll input. State the fixture boundary in evidence; do not represent it as an authenticated full-app or production test.

Produce `evidence.md`, `evidence.json`, and raw artifacts. If any criterion fails, record it in `problems.md`, apply the smallest safe correction, and rerun verification. Deliver the verified change through a squash PR to `master` under the repository's standing authorization.
