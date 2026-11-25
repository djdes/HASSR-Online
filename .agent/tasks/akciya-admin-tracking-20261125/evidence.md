# Campaign attribution evidence

The existing advertising URL remains unchanged. Proxy document navigation calls the recorder for the exact known /akciya + erid combination. Known bots, previews, HEAD, RSC and prefetch are ignored. Visit facts are platform-scoped AuditLog records with random browser IDs only; campaign facts survive the general audit-prune job.

The signed HttpOnly cookie expires 180 days after issuance. Standard confirm and instant-register explicitly opt into campaign attribution in requestSignupSource. The separate adCampaign field is passed unchanged into the organization's existing source JSON. First-touch fields and classification are preserved. Demo/contact requests do not opt in, so existing customers' demo requests cannot become new campaign registrations.

The report is mounted under the existing requireRoot-protected /root/funnel route. It scopes visits to the platform campaign, excludes demo/platform/directory organizations, returns counts and 50 recent organizations, and calculates conversion from distinct converting browser IDs rather than organization counts. SQL uses bound parameters. It does not fabricate historical visits.

Verification so far: 14 focused tests passed (regression-final.log), and all 83 related test files passed with 419 assertions (targeted-final.log, before the explicit registration-only opt-in refinement). i18n contract check passed. Typecheck and fresh final gate are being rerun against the refined implementation.

Builder validation: typecheck-ready.log exit 0 after fixing the test fixtures; targeted-final.log exit 0, 84 related test files and 442 passed. Registration-only attribution and unchanged first-touch behavior are covered. The fresh pass after merging the latest master will be saved as verify-typecheck.log and verify-gate.log.

The supported TEST_CHANGED_MAX_TESTS=90 setting runs the entire 83+ related-file selection without escalating solely because it crosses the default 80-file threshold. No selected tests are skipped and the test runner is unchanged. Git Bash must be on PATH for the gate wrapper on Windows.

Limitations: browser-based attribution needs cookies in the same browser; known bots are filtered heuristically. Identical reposted links are one campaign. Collection starts at deployment; no historical backfill or payment attribution is claimed.
