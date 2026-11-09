# Shared demo organization + point mismatch notice (2026-11-09)

Status: FROZEN

## Owner's request

1. Remove duplicate people so the platform shows unique users without their
   demo organizations (example: «Соколова Ирина Владимировна»).
2. One shared demo organization, reinstalled once a day with fresh data.
   Remove the "new demo organization per user" logic.
3. A journal document opened at point A must show an error after the header
   point is switched to B (today the document stays). Look for the same
   confusion in other sections.

## Design

### Shared demo
- One organization with the fixed id `demo` (`SHARED_DEMO_ORG_ID`),
  `isDemo = true`, no account. `demoExpiresAt` = when the next reinstall is due
  (install time + 24 h).
- Reinstall = delete the organization (cascade) and create + seed it again
  under the same id, so sessions and `lastActiveOrganizationId` keep pointing
  at a valid organization. Memberships are wiped: visitors return to their own
  organization and can open the demo again.
- Triggers: the daily cron `/api/cron/purge-demo-orgs` (path kept, it is
  scheduled outside the repo), a lazy reinstall when somebody opens a missing
  or overdue demo, and the ROOT button on `/root`.
- Access: `POST /api/organizations/demo` (account owner only, as before)
  ensures the demo, adds an `OrganizationMember` row and switches the session.
  No organization is created per user. `DELETE` is removed.
- Legacy per-account demo organizations are deleted by the cron (batched) and
  when their owner opens the shared demo.
- ROOT `POST /api/root/seed-demo-org` no longer creates organizations: it
  reinstalls the shared demo.

### Point mismatch
- Mismatch = points enabled, the object belongs to a point, the person looks
  at a trading point (`viewedPointId`) and it is a different one.
- The page shows a notice (which point the object belongs to, which is
  selected) with «Назад», «Перейти на точку …» and a link to the list of the
  selected point, instead of the object. UI guard only; access rules and API
  writes are unchanged.

## Acceptance criteria

- AC1: Opening the demo never creates an organization per account: every
  account owner lands in the organization `demo`; a second owner gets the same
  organization id.
- AC2: The shared demo is reinstalled with fresh data by the daily cron and
  lazily when it is missing or overdue; the organization id stays `demo`.
- AC3: Legacy per-account demo organizations are removed (cron, and on open
  for the opener's account); real organizations are never deleted
  (`isDemo: true` guard).
- AC4: The demo banner states that the demo is shared and refreshed daily, has
  «Вернуться в мою организацию» and no delete button; the profile menu opens
  the shared demo.
- AC5: Platform lists show each demo person once: only the shared demo is left
  in the «Демо» tab, the ROOT button does not add organizations.
- AC6: A journal document of point A opened while the header shows point B
  renders the mismatch notice instead of the document; with «Вся организация»,
  shared documents or points disabled the document opens as before.
- AC7: Other point-scoped detail pages found by the audit behave the same or
  are listed as intentionally cross-point.
- AC8: `npm run typecheck`, `npm run test:gate` and `npm run i18n:check` pass.
