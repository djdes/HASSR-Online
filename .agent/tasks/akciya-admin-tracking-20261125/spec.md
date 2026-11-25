# Frozen spec: existing campaign link analytics

User request: do not change the distributed /akciya?erid=... URL; show transitions and subsequent registrations in the site's admin.

- AC1: Count document GET navigations to the exact /akciya URL with the existing known erid, including directory sessions. Exclude known crawlers/link previews, HEAD, RSC and prefetch requests. Count views and unique signed browser IDs separately.
- AC2: Set a signed HttpOnly campaign cookie for 180 days and attach validated campaign/browser attribution to subsequent standard and instant registration source snapshots, even when an older first-touch source exists. Preserve first-touch fields; reject forged or expired campaign cookies.
- AC3: Add an authenticated admin report inside /root/funnel with stored views, unique browsers, registrations, unique-browser registration conversion and recent registered organizations. Show collection start and clearly explain that history cannot be recovered and browser attribution requires cookies. Exact erid identifies this shared campaign, not individual repost channels.
- AC4: Existing URL, access controls, registration and first-touch classification continue working. Analytics storage errors cannot fail navigation or registration. No schema changes, no personal IP or user-agent storage.
- AC5: New visible strings exist in ru/en/uz dictionaries and generated i18n contract is current. Typecheck and targeted tests pass; fresh verification reruns checks against final code.

Implementation boundary: use existing platform-scoped AuditLog for visit events and Organization.signupSourceJson for attribution. Render the report as a plain surface matching existing admin UI. No payments attribution or historical backfill; no public URL modifications.

Retention clarification before implementation: campaign visit facts must be excluded from the general 365-day audit-prune job, otherwise the all-time report would silently lose its denominator. This exemption contains only random browser IDs, not request IPs or user agents.

Verification: pure cookie/URL filtering regression tests, source attribution tests including both registration handlers, current-code report query/access review, targeted test gate and typecheck. Save raw logs and evidence here. No delegated agents requested.
