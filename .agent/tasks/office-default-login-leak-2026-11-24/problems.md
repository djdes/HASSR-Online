# Problems: office-default-login-leak-2026-11-24

Fresh verifier, round 2, on HEAD `60ec0ef07` (code diff vs `origin/master` `4f93950aa`, with the «AC4 amendment»
and the «Fixes after the fresh verifier (round 1…)» section of the spec).

**No open problems: every acceptance criterion is PASS** (see `verdict.json`).

## Round 1 problems — status

- **P1 (AC2) — fixed.** `src/app/root/me/mail-sender-form.tsx` has `method="post"`; the guard
  (`src/app/password-forms-post.test.ts`) also matches `type: "password"` / `autoComplete: "…-password"` object props
  and lists the file. Re-check: `/root/me` with page bundles blocked → fill the SMTP password → «Сохранить» →
  `POST /root/me` (200), URL stays `/root/me`, the password is in no URL or request URL. No other `.tsx` file uses
  the object-prop form.
- **P2 (AC6) — fixed as specified in the spec's fix section.** The office page hides «Добавить в офис» when there are
  no objects (`readOnly || !office || points.length === 0`). Re-check: one-object company with an open office →
  `DELETE` the object (200) → office page: four blocks, no «Добавить в офис», no «не распределены»,
  «Создать объект» and «Объектов пока нет» shown. The office row stays by decision; see the non-blocking note in
  `verdict.json`.

Round-1 notes that were fixed and re-checked: management bound to every object (or to the only object) stays
company-wide; the deploy loop survives a failing company; the ROOT metrics no longer count the office; the
«не распределены» strip is readable in dark theme.
