# Initial verification failure

Functional criteria AC1–AC3 passed regression and targeted checks, but release validation was blocked by typecheck (exit 2).

Reproduce: npm run typecheck. Actual: missing installed Sentry/mailparser/imapflow/telegram packages and missing weeklyIssue on the generated Prisma client. Expected: dependencies and generated client match the checked-in manifest and schema.

Smallest environment fix: install dependencies without changing the lockfile, regenerate Prisma client, rerun typecheck and targeted gate. No production schema operation is needed.

Fresh run exposed TS2322 at src/lib/max/telegram-channel.server.ts:80: Telegram username is optional in installed types. Minimal fix: return null if absent before returning bot info. The gate wrapper also requires Git Bash on PATH on Windows; use the installed Git Bash or the documented npm run test:changed equivalent.
