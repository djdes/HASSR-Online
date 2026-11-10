# Step 6 rollback: Next 16.4.5 + React 19.3.1 (#179)

- Deploy run 42807430326 (master 3b89ad63) failed at "Deploy step 2/3 — build + verify":
  `next build --webpack` (Next.js 16.4.5) died with
  `FATAL ERROR: Ineffective mark-compacts near heap limit … JavaScript heap out of memory`
  (heap ~3.85 GB, exit 134, after ~495 s).
- Step 1/3 had already run `npm ci` with the new lock, so the server's node_modules
  held Next 16.4.5 while PM2 kept serving the previous build 42366a1 (Next 16.1.6).
  Step 3/3 (db push, pm2 restart) was skipped; the site stayed up (/, /login,
  /api/build-info = 200), but a PM2 restart would have mixed versions.
- Why the local gate missed it: the local harness built with
  `NODE_OPTIONS=--max-old-space-size=8192`, while the server build runs with the
  default heap (~4 GB). Local gates must build exactly like the server.
- Action: `git revert` of #179 on master (AGENTS.md rollback rule). The revert
  restores package.json / package-lock.json (Next 16.1.6, React 19.2.3) and drops
  the `bfcacheId` fields that only Next 16.4 router types require. The next deploy
  runs `npm ci` with the old lock and rebuilds with Next 16.1.6.
- The Next upgrade is postponed until the build's peak memory is measured with the
  server's default heap and the owner decides on the build heap size.
