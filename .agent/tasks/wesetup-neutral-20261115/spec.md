# WeSetup: shared imagery and copy for every industry

Frozen 2026-11-15, before implementation.

Original request: «Унифицировать изображения и тексты по всему сайту Wesetup», including a medical centre asking «почему повар везде?» and the screenshot of the shift schedule.

Interpretation: use industry-neutral language and product imagery for shared website and application surfaces. Keep accurate food-specific material on food-specific pages, journal instructions and real job titles. Do not change roles, permissions, task assignment presets, regulatory requirements or customer data to achieve a cosmetic change. No new claims about medical compliance.

## Acceptance criteria

- AC1: The shift schedule addresses the responsible employee on duty, with no fixed cook. Shared personnel, room, workload, kiosk and onboarding guidance uses employees, managers and premises rather than assuming a kitchen. Apply corresponding changes in ru/en/uz; preserve ICU placeholders and rich-text tags.
- AC2: Shared landing, auth, footer, pricing/equipment and general feature copy includes medical centres and other supported industries without describing the whole service as food-only. Food niche pages and actual role labels remain meaningful.
- AC3: Shared visual demonstrations use neutral staff/organization examples. Audit brand marks, photos, screenshots, icons and videos, record each food-specific exception. Replace food-only screenshots used as universal staff examples with current interface captures using synthetic industry-neutral data; do not paint over or AI-fabricate a screenshot. Preserve the design system and responsive behavior.
- AC4: Record a concise editorial/imagery convention and the coverage audit. Run locale contract checks, focused affected tests, ESLint, typecheck and test:gate. Inspect rendered desktop/mobile results. Produce evidence.md/evidence.json/raw artifacts; then perform a separate fresh pass on current files and rerun checks, recording a verdict and problems/fixes for any non-PASS.
- AC5: Deliver scoped changes through a green, mergeable PR squash-merged to fresh master, preserving unrelated local edits; verify production deployment and live build identity. No schema or production customer-data changes.

## Verification

Inventory relevant strings and visual consumers before editing. Review the per-key before/after copy manifest across three locales. Compare typed ICU contracts. Exercise actual changed components in an isolated browser fixture and capture at desktop/mobile sizes. Rerun checks in a clean task checkout, inspect the final diff and record current-file hashes. Confirm current origin/master incorporation and green PR checks before merge, then deployed SHA and HTTP probes.

Artifacts live under .agent/tasks/wesetup-neutral-20261115/. No delegation is requested; implement and run a separate fresh verification phase in-thread.
