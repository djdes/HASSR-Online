<!-- repo-task-proof-loop:start -->
## Repo task proof loop

For substantial features, refactors, and bug fixes, use the repo-task-proof-loop workflow.

Required artifact path:
- Keep all task artifacts in `.agent/tasks/<TASK_ID>/` inside this repository.

Required sequence:
1. Freeze `.agent/tasks/<TASK_ID>/spec.md` before implementation.
2. Implement against explicit acceptance criteria (`AC1`, `AC2`, ...).
3. Create `evidence.md`, `evidence.json`, and raw artifacts.
4. Run a fresh verification pass against the current codebase and rerun checks.
5. If verification is not `PASS`, write `problems.md`, apply the smallest safe fix, and reverify.

Hard rules:
- Do not claim completion unless every acceptance criterion is `PASS`.
- Verifiers judge current code and current command results, not prior chat claims.
- Fixers should make the smallest defensible diff.
- For broad Codex tasks, bounded fan-out is allowed only after `init`, only when the user has explicitly asked for delegation or parallel agent work, and only when task shape warrants it: use bounded `explorer` children before or after spec freeze, use bounded `worker` children only after the spec is frozen, keep the task tree shallow, keep evidence ownership with one builder, and keep verdict ownership with one fresh verifier.
- This root `AGENTS.md` block is the repo-wide Codex baseline. More-specific nested `AGENTS.override.md` or `AGENTS.md` files still take precedence for their directory trees.
- Keep this block lean. If the workflow needs more Codex guidance, prefer nested `AGENTS.md` / `AGENTS.override.md` files or configured fallback guide docs instead of expanding this root block indefinitely.

Installed workflow agents:
- `.codex/agents/task-spec-freezer.toml`
- `.codex/agents/task-builder.toml`
- `.codex/agents/task-verifier.toml`
- `.codex/agents/task-fixer.toml`
<!-- repo-task-proof-loop:end -->

---

# HACCP-Online (WeSetup) — Agent Guide

## Project Overview

HACCP-Online (branded as WeSetup / Wesetup.ru) is a SaaS platform for electronic HACCP and SanPiN journals at food production facilities in the CIS market. It allows organizations to create, fill, and print regulatory compliance journals (temperature logs, hygiene checks, cleaning schedules, calibration records, etc.), manage staff, equipment, and integrate with external services like Telegram and TasksFlow.

The application is a Next.js 16 monolith deployed on a Linux VPS behind Nginx, managed by PM2.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16.1.6 (App Router) |
| Language | TypeScript 5 |
| UI Library | React 19.2.3 |
| Styling | Tailwind CSS 4 + `tw-animate-css` |
| Components | shadcn/ui (new-york style, CSS variables) |
| Icons | Lucide React |
| Database | PostgreSQL (via `pg` driver) |
| ORM | Prisma 7.4.2 with `@prisma/adapter-pg` |
| Auth | NextAuth.js 4 (JWT strategy, Credentials + Telegram providers) |
| Validation | Zod 4 |
| Toast notifications | Sonner |
| Charts | Recharts |
| PDF | jsPDF + jspdf-autotable |
| Excel | exceljs, xlsx |
| QR/Barcode | html5-qrcode, qrcode |
| Bot framework | grammy (Telegram bot) |
| IOT | Tuya Connector NodeJS |
| AI | Queue of the AI dispatcher (`docs/ai-dispatcher.md`): the site never calls a model directly |
| Runtime | Node.js 22+ |

## Project Structure

```
Wesetup.ru/
├── src/
│   ├── app/                     # Next.js App Router
│   │   ├── (auth)/              # Public routes: /login, /register
│   │   ├── (dashboard)/         # Protected routes with sidebar layout
│   │   │   ├── dashboard/
│   │   │   ├── journals/
│   │   │   ├── settings/
│   │   │   ├── staff/
│   │   │   ├── batches/
│   │   │   ├── capa/
│   │   │   ├── reports/
│   │   │   ├── plans/
│   │   │   ├── competencies/
│   │   │   ├── changes/
│   │   │   ├── losses/
│   │   │   └── sanpin/
│   │   ├── api/                 # API routes (REST endpoints)
│   │   ├── blog/                # Public blog pages
│   │   ├── invite/              # Invite acceptance pages
│   │   ├── mini/                # Telegram Mini App entry
│   │   ├── root/                # Platform admin pages (ROOT only)
│   │   ├── task-fill/           # External task fill entry
│   │   ├── equipment-fill/      # Equipment QR fill entry
│   │   ├── journals-info/       # Public journal info pages
│   │   └── features/            # Public feature/marketing pages
│   ├── components/              # React components
│   │   ├── ui/                  # shadcn/ui primitives
│   │   ├── journals/            # Journal-specific components
│   │   ├── dashboard/           # Dashboard components
│   │   ├── settings/            # Settings components
│   │   ├── staff/               # Staff management components
│   │   ├── shared/              # Shared cross-page components
│   │   └── public/              # Public page components
│   ├── lib/                     # Core business logic and utilities
│   ├── types/                   # Global TypeScript declarations
│   └── i18n/                    # Localization dictionaries
├── prisma/
│   ├── schema.prisma            # Database schema
│   ├── seed.ts                  # Main seed (templates, root user, demo data)
│   ├── seed-job-positions.ts
│   ├── seed-articles.ts
│   ├── seed-demo-screenshots.ts
│   └── seed-haccp-demo.ts
├── scripts/                     # Automation, tests, crawlers, pollers
│   ├── telegram-poller.ts       # Telegram long-polling daemon
│   ├── test-bot-wizard.ts       # Bot smoke tests
│   ├── capture-screenshots.ts
│   └── deploy.sh
├── public/                      # Static assets
├── .github/workflows/deploy.yml # CI/CD pipeline
├── next.config.ts               # Next.js config (build markers, cache headers)
├── src/proxy.ts                 # Next.js 16 proxy (ex-middleware): route guards, redirects, no-cache headers
├── postcss.config.mjs           # Tailwind PostCSS config
├── components.json              # shadcn/ui config
└── tsconfig.json                # TypeScript config
```

### Route Groups

- `(auth)` — Public pages: `/login`, `/register` (3-step wizard with email verification).
- `(dashboard)` — Protected pages with sidebar layout. All routes here require authentication.
- `root/` — Platform admin pages accessible only to `ROOT` users. Non-root requests return 404 (not redirect) to avoid leaking existence.
- `api/` — REST API endpoints. Common pattern: `getServerSession(authOptions)` → role check → ACL check → Zod validation → Prisma query → `NextResponse.json()`.

### Key `src/lib/` Modules

| File | Purpose |
|------|---------|
| `db.ts` | Prisma singleton with `@prisma/adapter-pg` pool |
| `auth.ts` | NextAuth configuration (JWT, Credentials, Telegram providers) |
| `auth-helpers.ts` | `requireAuth()`, `requireRole()`, `requireRoot()`, `getActiveOrgId()`, `isImpersonating()` |
| `journal-acl.ts` | `hasJournalAccess`, `canWriteJournal`, `canFinalizeJournal` with 60-second LRU cache |
| `validators.ts` | Zod schemas for API input validation |
| `email.ts` | Nodemailer wrappers (verification, invite, welcome, alerts) |
| `telegram.ts` | Telegram message sending with retry, dedupe, and `TelegramLog` |
| `pdf.ts` | jsPDF document generation helpers |
| `permissions.ts` | Permission codes and role-to-permission mapping |
| `user-roles.ts` | Role normalization helpers |
| `invite-tokens.ts` | 32-byte base64url invite tokens with SHA-256 hashing |
| `registration.ts` | 6-digit email verification code logic |
| `tuya.ts` | Tuya IoT device integration |
| `tasksflow-*.ts` | TasksFlow integration (sync, autolink, journal UI mapping) |
| `integration-crypto.ts` | AES-256-GCM encryption for third-party API keys |
| `today-compliance.ts` | Dashboard compliance scoring logic |

## Database Architecture

PostgreSQL with Prisma ORM. Key models:

- `Organization` — Tenant root. Contains subscription, locale, disabled journals, auto-journal codes.
- `User` — Employee or manager. Scoped to one org. Fields: `role`, `isRoot`, `isActive`, `archivedAt`, `journalAccessMigrated`, `telegramChatId`.
- `JobPosition` — Custom job titles per org (management/staff categories with sort order).
- `WorkShift` — Daily shift schedule enabling "assign task to position, not person".
- `JournalTemplate` — Metadata and JSON field definitions for each journal type.
- `JournalEntry` — Individual filled journal row (legacy dynamic form journals).
- `JournalDocument` + `JournalDocumentEntry` — Document-based grid journals (employee × day matrices, e.g., hygiene logs).
- `JournalObligation` — Per-user daily task queue for mobile/Telegram assignment.
- `Area` / `Equipment` / `Product` — Reference data scoped by org.
- `Batch` / `CapaTicket` / `LossRecord` / `ProductionPlan` / `ChangeRequest` / `StaffCompetency` — Operational modules.
- `TasksFlowIntegration` / `TasksFlowUserLink` / `TasksFlowTaskLink` — External task manager sync.
- `Notification` — In-app notification queue with deduplication.
- `AuditLog` / `TelegramLog` / `JournalExternalLog` — Observability tables.
- `EmailVerification` / `InviteToken` / `BotInviteToken` — Token tables with hashing.

Prisma uses `cuid()` primary keys. Multi-tenancy is enforced by scoping every query to `organizationId`.

## Authentication & Authorization

### Three-Tier Access Model

1. **ROOT** (`User.isRoot = true`): Platform superadmin in the synthetic `platform` org (`PLATFORM_ORG_ID=platform`). Sees `/root/*`. Can impersonate any organization.
2. **Management** (`role` in `{owner, manager, head_chef, technologist}`): Sees all journals and users in their org. Bypasses per-journal ACL.
3. **Employee** (`cook`, `waiter`, etc.): After `journalAccessMigrated=true`, only sees journals explicitly granted via `UserJournalAccess` rows. Before migration, has implicit access to all journals.

### Impersonation

ROOT clicks "Войти как X" → `POST /api/root/impersonate` writes `AuditLog` + client calls `useSession().update({ actingAsOrganizationId })`. The JWT callback stores `actingAsOrganizationId`. Dashboard shows a red sticky banner. **Always use `getActiveOrgId(session)`** in server code — never `session.user.organizationId` directly — to respect impersonation context.

### Session

NextAuth JWT strategy with 1-year max age. Custom cookie names prefixed with `haccp-online`. Telegram sign-in via `initData` HMAC verification (no auto-provisioning).

## Build and Development Commands

```bash
# Setup (first time)
cp .env.shared .env
npm install
npx prisma generate
npx prisma db push
npx tsx prisma/seed.ts

# Development
npm run dev              # Next.js dev server

# Build
npm run build            # Production build
npm run lint             # ESLint (Next.js core-web-vitals + typescript)

# Database
npx prisma generate      # Regenerate Prisma client
npx prisma db push       # Push schema changes (no migrations — prototype mode)
npx prisma studio        # Visual DB editor

# Seeds and scripts
npx tsx prisma/seed.ts
npx tsx prisma/seed-job-positions.ts
npx tsx scripts/telegram-poller.ts   # Run bot poller locally
npm run test:bot         # Run bot wizard smoke tests

# Checks (the git hooks run them too)
npm run typecheck        # tsc --noEmit (tsconfig.typecheck.json)
npm test                 # node --test via tsx over src/**/*.test.ts
npm run test:gate        # npm test gated by the baseline tests/.legacy-failures.txt
# One file: npx tsx --test src/lib/role-access.test.ts
```

## Testing Strategy

- **Unit tests**: Co-located as `*.test.ts` under `src/`. Node.js built-in `node:test` / `assert`, run through tsx.
- **Git hooks**: pre-commit runs the secrets check, `typecheck` and `test:gate` when `.ts/.tsx` files are staged; pre-push runs `typecheck` and `test:gate`. Do not bypass them with `--no-verify`; a new failing test must be fixed, not skipped.
- **Smoke tests**: `scripts/test-bot-wizard.ts` validates the Telegram bot registration wizard end-to-end.
- **Screenshot capture**: `scripts/capture-screenshots.ts` for visual regression evidence.
- **CI**: the deploy workflow runs `npm run typecheck` (fails the deploy) and `test:bot` (warn-only).
- **Production verification**: HTTP probes against `127.0.0.1:3002`, PM2 status checks, `.build-sha` / `.build-time` verification.

## Code Style Guidelines

- **UI text**: Russian (user-facing strings).
- **Code and comments**: English.
- **Path alias**: `@/*` maps to `./src/*`.
- **Next.js 16 params**: Page `params` are Promises — always `await params` before destructuring.
- **Toasts**: Use `sonner` (`toast.success()`, `toast.error()`). Never use the deprecated shadcn `toast` component.
- **Zod**: Version 4 syntax (not v3).
- **Prisma queries**: Always scope by `organizationId` or use `getActiveOrgId(session)`. Never query across orgs.
- **Fire-and-forget notifications**: Email and Telegram sends must be wrapped in `try/catch` so they never fail the main operation.
- **File naming**: kebab-case for utilities, PascalCase for components.

## Deployment

### CI/CD Pipeline

File: `.github/workflows/deploy.yml`
Trigger: push to `master` or manual `workflow_dispatch`.

Steps:
1. Checkout, install Node.js 22, `npm ci`
2. Write `.build-sha` and `.build-time` markers
3. Create `deploy.tar` (excludes `node_modules`, `.next`, `.git`, images, tarballs)
4. SCP tarball to production server
5. On server: extract, restore `.env`, clean-install `npm ci`, `prisma generate`, `npm run build`, `prisma db push`
6. Run seeds (`seed.ts`, `seed-job-positions.ts`, `seed-articles.ts`, `test-bot-wizard.ts`, `seed-demo-screenshots.ts`)
7. Restart PM2 processes: `haccp-online` (web) + `haccp-telegram-poller` (bot)

### Production Environment

- **Server**: Linux VPS, Nginx reverse proxy
- **Process manager**: PM2
- **App port**: `3002`
- **Deploy path**: `/var/www/wesetupru/data/www/wesetup.ru/app`
- **The deployed directory is NOT a git checkout** — verify using `.build-sha`, not `git status`.

### Required Environment Variables

Critical env vars (see `.env.shared` for template):
- `DATABASE_URL` / `DATABASE_URL_DIRECT` — PostgreSQL connection
- `PLATFORM_ORG_ID=platform`
- `ROOT_EMAIL`, `ROOT_PASSWORD_HASH` (or `ROOT_PASSWORD` for dev)
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` — SMTP relay (see `src/lib/email.ts`; empty `SMTP_HOST` in dev = emails only logged)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_LINK_TOKEN_SECRET`, `TELEGRAM_WEBHOOK_SECRET`
- `EMAIL_VERIFICATION_TTL_MIN`, `TELEGRAM_LOG_RETENTION_DAYS`
- `INTEGRATION_KEY_SECRET` — for encrypting third-party API keys
- `TASKSFLOW_*` — TasksFlow integration endpoints

## Security Considerations

- **Passwords**: Stored as bcrypt hashes. Invite tokens store SHA-256 digests, never raw values.
- **Email verification codes**: bcrypt-hashed with attempt limiting and TTL.
- **External API tokens**: Organization-scoped bearer tokens (`Organization.externalApiToken`). Idempotency keys prevent double-writes (`JournalExternalIdempotency`).
- **Third-party credentials**: Encrypted with AES-256-GCM (`integration-crypto.ts`).
- **Telegram init data**: HMAC-SHA256 verified against bot token before login.
- **ACL cache**: `journal-acl.ts` uses a 60-second LRU. Call `invalidateJournalAcl(userId)` after ACL changes.
- **Non-root `/root/*` access**: Returns 404 (not redirect) to prevent information leakage.
- **Cache headers**: App pages carry strict `no-store` headers. Next.js static assets (`/_next/static/*`) are cached for 1 year.

## Conventions for AI Agents

- Visible UI follows the project design system (`wesetup-design` skill, `.claude/skills/design-system`): every screen must look like one product.
- For non-trivial refactors, `karpathy-guidelines` is the coding discipline to follow; for a new feature that touches existing code, lock the scope first (a frozen spec, see the proof loop above).
- The `.cursorrules` file in repo root contains additional style rules (notably the git branch workflow).
- The local `CLAUDE.md` (not in git) holds operational notes: production probes, SSH access (the password stays in the local `.env`), architecture principles. Refer to it for deployment commands and troubleshooting.
