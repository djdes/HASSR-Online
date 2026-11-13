# Client correspondence from the platform panel

Frozen: 2026-11-13. Original request: «wesetup добавь возможность с личного кабинета админки клиенту произвольное письмо фирменное отправлять, по смтп пользователя с сохранением истории какие письма клиенту отправлялись и тд».

## Assumptions and scope

The sender is the signed-in platform-panel employee. Reuse their existing `/root/me` SMTP configuration and the existing WeSetup email layout. Place correspondence in the client's organization card, available to panel users with the clients section. Allow a single manually entered recipient or a suggested client contact. Store custom correspondence independently of best-effort audit logs. SMTP acceptance means sent, not confirmed inbox delivery. Existing contract, invoice and campaign mail behavior remains intact.

## Acceptance criteria

- AC1: Organization card exposes a branded custom-email form with recipient suggestions, subject, multiline body, sender identity, a link to personal SMTP settings and a server-rendered preview. Existing WeSetup styling, localization conventions, responsive layout and keyboard-accessible form controls are preserved.
- AC2: Only authorized clients-section panel users can read history, preview or send; all records and lookups are scoped to the route's organization, nonexistent organizations return 404, and sender identity is derived from the authenticated session.
- AC3: Custom emails use only the current employee's enabled, verified personal SMTP; no silent system fallback. The preview and sent message use the same escaped body and subject, existing brand layout and personal signature. User HTML is treated as text. Invalid recipients, synthetic email addresses, empty/oversized fields and header injection are rejected.
- AC4: Persist recipient, subject, full text and rendered HTML, sender identity, timestamps and send status/error before/after SMTP. History survives sender profile changes and is paginated and viewable from the client card. Status text never claims inbox delivery. SMTP details/secrets are not exposed.
- AC5: A request key prevents duplicate SMTP sends on repeated/concurrent submissions. Failure or uncertain network outcomes do not trigger automatic retries or system-mail fallback. UI preserves a failed draft, handles loading/network errors, and refreshes history after attempts.
- AC6: Meaningful validation, rendering, authorization, tenant-scope, persistence, idempotency and SMTP-failure tests pass; typecheck and baseline test gate pass for the delivered task changes. A fresh current-source verification produces evidence.md, evidence.json, raw logs and an AC verdict.

## Non-goals

Bulk campaigns, attachments, WYSIWYG HTML, inbound replies, read/open tracking, delivery webhooks, changing existing document send behavior, configuring customer-owned SMTP.

## Verification

Run focused tests and targeted ESLint, generate Prisma client, run typecheck and test:gate, and inspect the rendered composer/history at desktop/mobile widths using existing local browser tooling when available. Mock SMTP in tests; do not send a real client email. Independently reread current changed source and rerun checks for final verdict. Deliver via a green, mergeable PR squash-merged into current master under the repository's standing authorization. Database deployment adds only an organization-scoped correspondence table and indices.
