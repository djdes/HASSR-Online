# Restore administrator Telegram notifications

Task: admin-telegram-notifications-2026-10-09
Frozen: 2026-10-09 before implementation

## Request
Restore administrator notifications in @wesetupbot: public online chat, registered-user support, new registrations and all existing platform-admin notification events. The owner reports that delivery stopped after 2026-09-30. Restore the production service and preserve replying from Telegram.

## Scope
Inspect the common delivery path, recipient configuration, production process environment, Telegram transport and event callers. Apply the smallest fix supported by evidence. Add meaningful regression coverage for the diagnosed failure. Deploy only this repair or restore the diagnosed production configuration, preserving unrelated working-tree changes.

## Acceptance criteria
- AC1: Identify the failure with current production/code evidence, and inventory existing administrator notification event kinds and callers.
- AC2: Correct delivery for public and authenticated online-chat messages, including subsequent messages in a conversation, while preserving existing routing, attachments, persistence and Telegram reply markers.
- AC3: Restore the common delivery path used by registrations, leads, payments, feedback and other existing administrator events; do not broadcast to customers or change tenant-scoped routing.
- AC4: Regression checks for the diagnosed cause pass; affected support/Telegram checks, typecheck and the repository test gate pass against the final code. Rerun final targeted checks in a fresh verification pass.
- AC5: The production repair is installed, web and Telegram poller are healthy, and a labelled administrator-only delivery test plus an online-chat notification test have confirmed delivery. Record sanitized evidence and event IDs; avoid replaying customer history in bulk.
- AC6: Create evidence.md, evidence.json, raw artifacts and a fresh verdict against the current repository and production results. Never store tokens, SSH passwords, complete environment files or customer message bodies in task evidence.

## Constraints
Do not revert existing edits. No database/schema migration unless the diagnosed failure proves it necessary. Do not expose secrets. Do not register real customers or send test messages to customers. Preserve throttling and tenant isolation. Any failing acceptance criterion must remain explicitly incomplete; write problems.md and apply the smallest safe fix before reverification.
