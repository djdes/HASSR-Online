# Verification findings

## Builder fixture setup

- Initial browser verification failed before rendering: esbuild could not resolve `react/jsx-runtime` in virtual boundary stubs. Raw evidence: `raw/builder/browser.log`.
- Smallest correction: set the virtual stubs' `resolveDir` to the repository root. This changes only the verification fixture; production code is unaffected.
- Rerun required after correction.

## Duplicate existing PDF links

- Responsive layout and input checks passed, then the all-landings check encountered two existing links named `Печатные формы PDF` (hero and related links). Raw evidence: `raw/builder-final/browser.log`.
- Smallest correction: scope the fallback assertion to the hero section. Also pin the original-regression comparison to the original master SHA so the fixture remains reproducible after committing.
- Rerun required after correction.

## Server environment in browser fixture

- The next fixture run timed out waiting for the heading. Diagnostic browser output identified `process is not defined`: shared server-side configuration reads `process.env`.
- Smallest correction: supply an empty production environment in the browser bundle. No real environment variables or secrets are injected. Production source remains unchanged.
- Rerun required after correction.
