# Verification findings

## V1 — Next internal rewrite executed proxy twice

The actual browser received Russian HTML at `/en` while pure proxy tests passed. Isolated diagnostic logs showed `/en en`, followed by `/ ru`, then server locale `ru`. Next's destination hostname normalization treated the localhost rewrite as a second request in the loopback deployment. This can depend on proxy/host configuration.

Small fix: use an explicit `src/app/en/page.tsx` alias that reexports the same landing implementation; the proxy now only stamps the trusted locale and continues the request. No runtime translation, duplicate page content or host-dependent rewrite is needed. Registry and ACL behavior remain unchanged. This refines the implementation mechanism within frozen AC1/AC4; no scope expansion.

Reverification: actual English SSR and no-JavaScript navigation now pass; all six QR chapters, 320px switching, login/second factor/reset, support validation, sitemap, OG image and private-route 404 behavior also pass. Final verification remains pending.

## V2 — Existing terminology scanner flags translation keys

Full gate: 3374 passed, one failed (`no-blank-word`). The dictionary contains the Russian keys of the two already-exempt links to downloadable empty forms. Add only those same two exact keys to the scanner exceptions, with a reason. Do not weaken exclusions for actual journal interfaces or change the legacy baseline.

## Verification harness findings

- Next normalizes the root hreflang URL to the equivalent origin without trailing slash; compare normalized URLs.
- Select QR chapter controls by their accessible navigation container, not a whitespace-dependent text regex.
- Replace Windows `select()` over Paramiko channels with two stream pumps after a tunnel socket failure. Keep loopback-only binding and pinned SSH.
- Multi-page development-server checks intermittently received truncated JavaScript. Saved layout chunks were exactly 327680 bytes instead of 972095 bytes. A direct loopback fetch on Linux also returned 0, 972095 and 65536 bytes across three requests, ruling out the SSH tunnel as the cause. Verify the unchanged application using an isolated production build; do not hide page errors or weaken CAPTCHA assertions.

## V3 — Narrow header and root-layout persistence

The 320px screenshot showed the sign-in control clipped; checking document scroll width missed this because the landing clips overflow. Keep sign-in and RU/EN visible, reduce optional navigation at narrow widths, allow header wrapping, and assert every visible header control stays inside five viewport widths both before and after scrolling.

Next root layouts persist during client transitions. Reload language-boundary destinations, including successful English authentication, so Russian pages cannot retain English client context. English auth route aliases must also reuse the existing auth layout; added explicit layout reexports to preserve signed-in redirects. Final browser cases cover these paths.

## Outstanding scope

AC3 remains incomplete: only landing/login/registration are translated. The user has not answered whether the authenticated workspace/journals are included; other public pages are also not translated. `coverage.md` is the authoritative inventory. Do not close the ProjectsFlow task or claim the entire requested English version is complete.

## V4 — Cookie notice on English authentication routes

Final shared-component inspection found the notice's exclusion list only matched Russian `/login` and `/register`. Normalize explicitly translated paths before applying that existing list, preserving the rule that the banner must not cover auth forms on a narrow screen. Its privacy link also needs the locale-aware link wrapper, so a Russian policy page receives a fresh Russian root layout. Added a browser scenario for both English auth routes and the actual policy-link transition. Reverify before treating this fix as complete.

The new browser case exposed a pre-existing false positive: public-theme initialization adds `app-shell public-theme` to `<body>`, so the banner's broad `.app-shell` query hides it on the landing too. Restrict the workspace check to `.app-shell:not(.public-theme)`; real private shell elements still match. This small shared-component fix is necessary for the translated cookie notice and policy link to actually be usable. Rebuild and rerun the full browser suite.

Final reverification: production build, typecheck, lint, 40 focused tests, all 3375 full tests and all 10 browser scenarios pass. The browser reports no JavaScript errors. V4 is resolved; the overall task still remains incomplete under AC3.

Evidence packaging caught a stale manifest: collecting remote raw files had restored the prior commit's source hash list. The commit guard rejected the mismatched evidence before staging. Synchronize manifests during source transfer and confirm every remote source is byte-identical to the local source (zero source changes) before repackaging the already-current successful checks.
