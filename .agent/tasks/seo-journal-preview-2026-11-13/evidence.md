# Journal landing preview evidence

Verdict: **PASS**.

Verified source at HEAD `6a15b6dffeffc45f0a82bda5b4628af2d04d7452` with the production file hashes in evidence.json.
Frozen spec SHA-256: `f6e33db7d5c5f66908c53d202e85e6b2854ca8986d5993884409ba7fa41273e3`.

| Criterion | Status | Evidence |
| --- | --- | --- |
| AC1 | PASS | Real cleaning template: sample section index 1, required fields immediately afterwards, four rooms plus responsible/controller rows, 16 columns and demo-data copy. |
| AC2 | PASS | All 13 landing configurations checked at 375 and 1440 px; supported PNG/WebP assets decoded; unsupported pages omit the preview. |
| AC3 | PASS | 320/375/768/1440 px: no horizontal document overflow. At 320/375 px real wheel and keyboard input scroll the table, vertical wheel still scrolls the page. Fixture requires no auth, DB or app server. |
| AC4 | PASS | Registration href and cleaning PDF boundary props preserved; custom download URL priority and unsupported PDF fallback verified. Original download components and PDF route are unchanged. Existing cleaning card matrix scrolls. |
| AC5 | PASS | Fresh verification reran browser, ESLint, typecheck and repository changed-test gate with stable HEAD and unchanged spec/source/lock hashes. |

## Commands

- browser: exit 0; raw log: raw/verifier/browser.log
- lint: exit 0; raw log: raw/verifier/lint.log
- typecheck: exit 0; raw log: raw/verifier/typecheck.log
- test-gate: exit 0; raw log: raw/verifier/test-gate.log

## Scope and limits

- Bounded browser fixture: public header/footer and Next Link are stubbed; download props are observed at the existing email-dialog boundary. No full Next server, email delivery, PDF generation, database or production deployment test is claimed.
- npm run test:gate uses the repository changed-file runner; this is not a claim that the full test suite ran.

Raw browser measurements: raw/verifier/browser.json. Responsive screenshots: raw/verifier/cleaning-{320,375,768,1440}.png.
The original missing sample and blocked matrix scrolling were reproduced against the pinned original master SHA. Fixture setup failures and their corrections are recorded in problems.md; production source did not require a correction.

Production impact: two presentation components only; no schema changes. Registration and the email-gated PDF download implementation remain unchanged.
