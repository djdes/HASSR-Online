# Spec (frozen 2026-11-10): Dependabot PRs #194, #192, #196, #195, #193 one by one

Owner: «делай по очереди, если что откатывайся, главное работоспособность прода».

## Order (lowest risk first; one step = one PR = one deploy; next step only after a green deploy)

1. #194 — patch group: next 16.1.7, react / react-dom 19.2.9, eslint-config-next 16.1.7, docx 9.7.2,
   lucide-react 1.70.
2. #192 — actions/upload-artifact 4 → 7 (only `screenshots.yml`, manual workflow).
3. #196 — dotenv 17 → 18 (loads `.env`: prisma.config.ts, scripts, seeds).
4. #195 — nodemailer 7 → 10 (all e-mail).
5. #193 — appleboy/scp-action 0.1.7 → 1.0.0 (deploy upload fallback).

Each package update is applied on a branch from fresh master with `npm install <pkg>@<version>`
(lock regenerated from current master, not Dependabot's stale lock); the Dependabot PR is then closed.
A major version is taken only after reading its changelog/breaking changes and checking every call site.

## Acceptance criteria per site step

- **AC1** `npm ci`, `prisma generate`, `npm run typecheck`, `npm run i18n:check`, full test suite (lock changed).
- **AC2** eslint not worse than master.
- **AC3** `next build` with the server's heap (8192 MB since #191), `next start`, smoke over 46 pages + 3 PDFs
  vs master baseline, screenshots vs master where UI can change; step-specific checks (e-mail rendering /
  sending to a local catcher for nodemailer, `.env` loading paths for dotenv).
- **AC4** Deploy on master green (build, post-deploy check, tests); production pages 200.
- **Rollback rule**: deploy red or production broken after a step → `git revert` of that step on master
  immediately, deploy the revert, then investigate. A step that fails local checks is not shipped.
