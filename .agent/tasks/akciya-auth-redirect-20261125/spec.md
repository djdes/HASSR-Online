# Frozen spec: authenticated campaign landing

Request: /akciya?erid=... redirects to /master for an authenticated visitor.

Scope: allow the exact public campaign landing through the directory-session guard.

- AC1: /akciya is allowed for directory sessions, including navigation with erid (the guard receives URL.pathname).
- AC2: regular and anonymous session kinds still allow /akciya.
- AC3: directory sessions still redirect private pages and reject private APIs; similar-looking campaign paths gain no access.

Non-goals: changing session roles, billing, promo redemption, public copy or other route policies.

Verification: regression tests in master-directory-access.test.ts, typecheck, targeted test gate; repeat current-code verification and save raw output.

Verification-driven amendment: current Telegram types make getMe().username optional. Permit a minimal guard returning null for a missing username to preserve telegramBotInfo's declared contract and unblock typecheck. No integration behavior changes for valid bot usernames.
