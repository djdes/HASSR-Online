# Evidence — dependency updates one by one (2026-11-10)

Spec: `spec.md` (frozen). Problems and fixes: `problems.md`. Raw artifacts: `raw/`.

AC per site step: AC1 install/types/tests/i18n, AC2 lint not worse, AC3 build as on the server +
`next start` + page smoke vs master, AC4 deploy green (build, post-deploy check, tests).

| Step | What | PR | Result |
|---|---|---|---|
| 1 | Mobile: store listing rebuild + Capacitor 8.6 (Dependabot #133) | #166 | PASS — mobile CI green, deploy run green |
| 2 | Mobile: @capacitor/assets 4 (#135) | #167 | PASS — deploy run green |
| 2 | Mobile: TypeScript 7 (#137) | — | REJECTED — `ts.transpileModule` is undefined in TS 7, `cap config` fails; PR closed |
| 3 | Site: eslint 10 (#139) | — | REJECTED — config cannot load `eslint-plugin-react` under eslint 10 (plugins not yet compatible); PR closed |
| 4a | Site: server libraries (grammy, zod, pg, mysql2, next-auth, imapflow, mailparser, jspdf, …) | #169 | PASS — `raw/step4a-*` |
| 4b | Site: UI libraries (radix-ui, react-hook-form, recharts, sonner, tailwind-merge, …) | #171 | PASS — `raw/step4b-*` |
| 5 | Site: Prisma 7.10.1 | #175 | PASS — `raw/step5-*`, migrate diff empty |
| 6 | Site: Next 16.4.5 + React 19.3.1 | #179 | **AC4 FAIL** — server build out of memory; reverted by #182 (deploy green). See `problems.md` P1, `raw/step6-rollback.md`, `raw/step6-build-memory.md`. Postponed |
| 7 | Site: lucide-react 1.68 (#140) | #184 | PASS — `raw/step7-*` (build at 4 GB heap) |
| 7c | Site: Tailwind CSS 4.3.5 (from #183) | #187 | PASS — `raw/step7c-*`; CSS diff equivalent, screenshots identical except clock text |
| 8 | CI: actions/checkout v7 + setup-node v7 (#134, #136) | #189 | PASS — `raw/step8-actions.md`; PR check (gogetlinks-check) green on v7; deploy run 42840946757 green, Node 20 deprecation warning gone |

Final verification (current master 15f045a7, served by production as build 15f045a):
- deploy run 42836467453 (Tailwind, bae93c8f — same site code as now) ran the **full** suite in CI:
  Full Tests 1/4–4/4 green, Type-check green, deploy + post-deploy check green;
- deploy run 42840946757 (15f045a7): gate on checkout@v7/setup-node@v7 green, deploy green;
- production probes after the last deploy: `/`, `/login`, `/pricing`, `/journals-info`, `/blog`,
  `/api/build-info` → 200.

Dependabot PRs: #133, #135, #137, #139, #140, #134, #136, #164, #183, #188 closed (taken in the PRs above,
or rejected with the reasons below). Dependabot regroups the rejected packages (incl. Next 16.4.5) into a new
"minor-and-patch" PR after every dependency change; merging such a PR would repeat the step 6 failure.

Packages deliberately kept at the current version (reasons as recorded in #169/#171):
- `undici` 8.1.0 (8.12: the Telegram bot stops going through the proxy, `telegram-health` test — getMe aborts);
- `docx` 9.7.1 (9.15 adds colour 44546A/dark2 to Word styles; printed journals must be colourless, `print-colors` test);
- `remotion` / `@remotion/*` 4.0.528 (promo video only, does not affect the site; not updated);
- `api-anything` 0.3.2 (0.x release; the GoGetLinks integration cannot be verified end-to-end from here);
- `eslint-config-next` 16.1.6 (16.4.5 brings React Compiler lint rules: +77 lint errors);
- `next` 16.1.6 / `react` 19.2.3 (step 6).

Harness lesson (step 6): local gate builds now use `NODE_OPTIONS=--max-old-space-size=4096`
(server default heap ≈ 4.13 GB); with it the 16.4.5 OOM reproduces locally.

Side observation (not caused by these steps): from this sandbox ~3–5 % of HTTPS connections to
wesetup.ru stall in the TLS handshake (proxy log: 517 B sent, 39 B received, tunnel closed after
10–15 s); first seen 12:02 UTC, before steps 7–8; a control host had 0 such failures.
