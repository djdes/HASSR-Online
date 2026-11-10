# Evidence — stable server build memory + Dependabot ignore rules (2026-11-10)

Spec: `spec.md`. Shipped in PR #191 (master 8113e723), deploy run 42851578995.

| AC | Result | Evidence |
|---|---|---|
| AC1 heap for both server builds, prior NODE_OPTIONS kept, logged; deploy.sh too | PASS | deploy log step 2/3: `[build] NODE_OPTIONS=--max-old-space-size=8192`, «Compiled successfully in 3.8min»; bash check: Node heap limit 8240 MB with and without pre-existing NODE_OPTIONS (kept: `--enable-source-maps --max-old-space-size=8192`); step 3 (pm2) untouched |
| AC2 Dependabot ignores rejected updates, patches of Next/React allowed | PASS | `.github/dependabot.yml` parses; GitHub's Dependabot runs on 8113e723 for `/`, `/mobile`, github-actions all succeeded; the new group PR #194 contains next 16.1.7, react/react-dom 19.2.9, eslint-config-next 16.1.7 (patches), docx 9.7.2 (patch), lucide-react 1.70 — no Next 16.4 / React 19.3 / undici / remotion / api-anything |
| AC3 test locks AC1 + AC2 | PASS | `src/lib/deploy-build-memory.test.ts` 5/5; tests reading deploy.yml and scripts/ 44/44 |
| AC4 YAML valid, typecheck, deploy green, prod 200 | PASS | `bash -n` on step 2/3 script and deploy.sh; `npm run typecheck` clean; deploy run 42851578995 success incl. post-deploy check (`[verify] сайт отдаёт 8113e72`); `/`, `/login`, `/pricing`, `/api/build-info` → 200 |

Not in scope, opened by Dependabot after the config change (left open for the owner's decision):
#192 actions/upload-artifact 4→7, #193 appleboy/scp-action 0.1.7→1.0.0, #195 nodemailer 7→10, #196 dotenv 17→18, #194 patch group.
