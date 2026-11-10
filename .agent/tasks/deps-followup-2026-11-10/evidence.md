# Evidence — Dependabot #194, #192, #196, #195, #193 one by one (2026-11-10)

Spec: `spec.md`. Raw: `raw/`. Every shipped step: own PR, green deploy, production pages 200 before the next step.

| Step | Update | PR / deploy | Result |
|---|---|---|---|
| 1 | next 16.1.7, react/react-dom 19.2.9, eslint-config-next 16.1.7, docx 9.7.2, lucide-react 1.70 (#194) | #200 → run 42901552252 (incl. full tests 4/4) | **PASS** — `raw/d1-*`: npm ci, typecheck, full suite 6080/0, eslint = master (41/220), build at 8 GB heap, smoke 46 pages + 3 PDF = fresh master baseline, headers identical, screenshots identical except date/time text |
| 2 | actions/upload-artifact 4 → 7 in screenshots.yml (#192) | #201 → run 42903387057 | **PASS** — inputs name/path/retention-days unchanged, new `archive` defaults to old behaviour; v7 already used by mobile workflows |
| 3 | dotenv 17.4.1 → 18.0.9 (#196) | #202 → run 42906836032 (incl. full tests 4/4) | **PASS** — `raw/d3-summary.txt`: removed features unused; `.env` loaded on every code path without DATABASE_URL in env (require().config, tsx `dotenv/config`, config({path}), prisma validate/db push, apply-safe-schema --dry-run); full suite 6080/0, smoke = master; Telegram poller on dotenv 18: online 12 min, 0 restarts (PM2 table in run 42908688386) |
| 4 | nodemailer 7.0.13 → 10.3.1 (#195) | not shipped; #203 → run 42908688386 | **REJECTED** — `raw/d4-nodemailer.md`: e-mails identical v7 vs v10 through a local STARTTLS+AUTH SMTP, but `npm ci` fails with ERESOLVE (next-auth 4.24.15 peer nodemailer ^7). Kept 7.0.13 (latest 7.x); Dependabot ignore rule for nodemailer majors + test |
| 5 | appleboy/scp-action v0.1.7 → v1.0.0 (#193) | #207 → run 42910346307 | **PASS** — `raw/d5-scp-action.md`: drone-scp 1.6.14 vs 1.8.0 on a local OpenSSH server with password login: deploy tarball byte-identical, screenshots tree identical, re-upload replaces, wrong password exits 1 |

Rollback rule was not needed: no step reached production broken. The one step that would have broken the
server deploy (nodemailer 10) was caught by the local clean `npm ci` and not shipped.

Final state: master dfce7790, production build dfce779, last deploy green, `/`, `/login`, `/pricing`,
`/journals-info`, `/blog`, `/api/build-info` → 200.

After the dependabot.yml change Dependabot opened new PRs (out of this spec, left for the owner):
#204 @anthropic-ai/sdk 0.78 → 1.6, #205 @types/bcryptjs 2.4.6 → 3.0.0, #206 shadcn 3.8.5 → 4.23.
