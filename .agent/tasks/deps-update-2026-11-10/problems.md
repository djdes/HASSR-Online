# Problems found during verification

## P1 — Step 6 (Next 16.4.5 + React 19.3.1, #179): AC4 FAIL — server build out of memory

- **What failed:** deploy run 42807430326 (master 3b89ad63), then again run 42810443737
  (master e969892a, #181 on top): "Deploy step 2/3 — build + verify" died with
  `FATAL ERROR: Ineffective mark-compacts near heap limit … JavaScript heap out of memory`
  (heap ~3.82–3.85 GB of a ~4.13 GB limit, exit 134).
- **Impact:** none for users. Step 3/3 was skipped, PM2 kept serving build 42366a1 (Next 16.1.6);
  `/`, `/login`, `/api/build-info` stayed 200. Risk: the server's node_modules already held
  Next 16.4.5 while the running build was 16.1.6.
- **Why AC3 passed locally:** the local harness built with `--max-old-space-size=8192`, so AC3
  was not "as on the server". The server build runs with Node's default heap (~4.13 GB).
- **Fix (smallest safe):** `git revert` of #179 on master — PR #182, deploy run 42811257254
  success; production serves 70eb578 (Next 16.1.6) and the post-deploy check passed.
- **Harness fix:** local gate builds now use `--max-old-space-size=4096` (slightly below the
  server limit). With it the Next 16.4.5 OOM reproduces locally (exit 134 after 260 s).
- **Measurements:** `raw/step6-build-memory.md` — Next 16.4.5 needs ~5.1 GB of heap; 16.1.6
  needs ~4.19 GB unconstrained and builds under 4 GB only because GC squeezes it.
- **Status:** Next 16.4.5 / React 19.3.1 postponed. Retrying needs an owner decision on the
  build heap (server RAM unknown to the agent) or a build-memory reduction.
