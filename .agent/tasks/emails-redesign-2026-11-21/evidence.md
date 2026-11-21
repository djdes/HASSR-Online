# Evidence — emails-redesign-2026-11-21

Verified 2026-11-21 on the working tree (base `origin/master` `b2a311f79`): typecheck, the test gate (escalated
to the full suite), ESLint, and a visual preview of 16 site emails sent through the real send functions into a
local SMTP sink (`raw/preview-emails.ts`) and screenshotted at 390 px (`raw/preview-390.txt`).

| AC | Verdict | Proof |
|----|---------|-------|
| AC1 layout | PASS | `email-layout.test.ts`: no `#0b1024` band, no grey margins, logo on white, title as text in the gradient band (no «— WeSetup»), 600 px column, 17 px base, footer left, `color-scheme: light`. Cause of the «black strip»: dark `logo-email.png` on a dark band (invisible; empty band without images). |
| AC2 bigger | PASS | `enlargeEmailHtml`: 11–16 px → +2, headings/1 px untouched; buttons 15×28 px, radius 14 (test). Preview: smallest text 14 px, most 15–17 px. |
| AC3 fewer words | PASS | Lifecycle: «поможем начать» 48 words, trial reminder shorter, facts kept (`lifecycle/emails.test.ts`, length limits). 32 dictionary keys × ru/en/uz shorter with identical placeholders (catalog tests); owner-dictated welcome phrases kept (`welcome-email.test.ts`). Billing: three longest phrases trimmed. |
| AC4 visual | PASS | `raw/preview-390.txt`: 16 emails, `scrollW=390` (full width, no horizontal scroll), titles listed; screenshots in the local scratchpad (gitignored). |
| AC5 checks | PASS | `raw/typecheck.txt` exit 0; `raw/test-changed.txt` full suite pass 6895, fail 0; `raw/lint.txt` exit 0. |

Also fixed: `blank-qr-token.test.ts` probed a random base32 token for «zav» (3 letters, ≈0.2 % chance of a
coincidental match — it failed once during this task); it now probes «example» (7 letters). Not a skip: same
intent, no random collisions.

Not changed: team-only notices (CRM, ROOT, SEO), marketing promo designs and proposals (own layouts).
