# Spec (frozen 2026-11-10): stable server build memory + Dependabot stops proposing known-broken updates

Owner's answers (2026-11-10): the server has 61 GB RAM, ~36 GB free; "сделай чтобы было стабильно и
отключи" (make deploys stable, stop Dependabot proposing Next/React); no need to re-accept the offer.

Background: `.agent/tasks/deps-update-2026-11-10/raw/step6-build-memory.md` — the server build runs on
Node's default heap (~4.13 GB). Current master (Next 16.1.6) needs ~4.19 GB unconstrained and fits only
because GC squeezes it; Next 16.4.5 needs ~5.1 GB and failed twice with OOM.

## Acceptance criteria

- **AC1** Deploy step 2/3 (`deploy.yml`) runs both server builds (`npm run build` and the clean
  rebuild) with `--max-old-space-size=8192` added to `NODE_OPTIONS` (existing NODE_OPTIONS kept),
  and logs the value. PM2 / the running site are not affected (step 3 is a separate shell).
  The manual fallback `scripts/deploy.sh` builds with the same limit.
- **AC2** `.github/dependabot.yml` stops proposing the updates that were checked and rejected:
  next / react / react-dom / @types/react / @types/react-dom / eslint-config-next minor+major
  (patch releases stay allowed — security fixes on 16.1.x / 19.2.x), undici and docx minor+major,
  remotion + @remotion/* all, api-anything minor+major, eslint major (root), typescript major (/mobile).
  Each rule says why.
- **AC3** A unit test locks AC1 and AC2 (heap set before both builds and in deploy.sh; ignore rules present).
- **AC4** YAML valid; `npm run typecheck`, the new and related tests pass; the deploy after merge is
  green, its log shows the new NODE_OPTIONS, production answers 200.
