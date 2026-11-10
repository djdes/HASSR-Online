# Build memory: Next 16.1.6 vs 16.4.5 (measured 2026-11-10)

Same codebase (master after #181), `next build --webpack`, local machine 4 CPU / 15 GB.
Heap numbers come from `next build --experimental-debug-memory-usage`; RSS from /proc sampling.

| Build | Heap limit | Result | Time | Peak heap used | Peak RSS (largest process) |
|---|---|---|---|---|---|
| Next 16.1.6 (master 70eb578) | 4096 MB | OK | 408 s | ≤ 4096 MB (squeezed by GC) | 6.3 GB |
| Next 16.1.6 (master 70eb578) | 8192 MB | OK | 456 s | 4186 MB | 7.8–8.1 GB |
| Next 16.4.5 (3b89ad63) | 4096 MB | **OOM, exit 134** after 260 s | — | — | — |
| Next 16.4.5 (3b89ad63) | 8192 MB | OK | 500 s | 5109 MB | 9.6 GB |

Server: deploy step 2/3 runs `npm run build` without NODE_OPTIONS; both failed server
builds died at a heap of ~3.82–3.85 GB with the limit at ~4128 MB (deploy runs
42807430326 and 42810443737).

Conclusions:
- Next 16.4.5 needs ~0.9 GB more heap than 16.1.6 for this project; it cannot build
  with the server's default heap. The local OOM at 4096 MB reproduces the server failure.
- Current master on 16.1.6 is already at the edge: unconstrained it peaks at ~4.19 GB,
  i.e. above the server's default limit; it builds only because GC keeps it under
  4 GB. Further code growth may make even 16.1.6 deploys fail with the same OOM.
- Fix options (owner decision, needs the server's RAM): set
  `NODE_OPTIONS=--max-old-space-size=6144` for the build in deploy step 2/3
  (expect ~8–10 GB peak RSS while the live site keeps running), or reduce build
  memory (e.g. webpack worker/parallelism settings) before retrying Next 16.4.
