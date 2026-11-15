# Current-code verification

Status: READY_FOR_RELEASE. AC1–AC4 PASS; AC5 awaits the green master release and live build identity.

The frozen scope is checked against the current code after incorporating origin/master (ab7a4e15ff1a4e283862aa168e19130d00dfa686). A separate verification phase reran the source audit and mandatory commands; repaired findings are in problems.md.

- AC1: 84 exact message paths per locale checked in ru/en/uz, ICU parameters/tags retained. Actual role labels preserved. Schedule reminders address the responsible employee on duty.
- AC2: Shared marketing, auth, footer, metadata, equipment/pricing and general guidance include medical centres and neutral workplaces. Generic FAQ does not extend food-specific law to medical users.
- AC3: Actual staff component captures replace universal canteen examples. QR staff captions localized. Auth uses existing industry icons. All 24 browser checks pass across three locales, desktop/mobile; corrected desktop login, staff, schedule and QR captures visually inspected. See audit.md for retained food-specific media.
- AC4: typecheck, gate (276 tests across 66 files), locale checks (97), focused brand/QR tests (16) and changed-source ESLint pass. Source hashes and exact catalog paths are in raw/source-audit.json. Editorial convention: docs/brand-content.md.
- AC5: Pending PR/production verification. No database/schema/customer changes.

Raw commands/logs, the synthetic browser fixture and screenshots are alongside this document. Node dependencies are reused from an existing checkout; the fixture makes no live API writes.
