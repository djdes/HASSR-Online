# Problems: office-default-login-leak-2026-11-24

Verifier pass on `claude/amazing-bohr-s3zvbx` HEAD `bd26f8fcc` (code diff vs `origin/master` `4f93950aa`, including
the «AC4 amendment»: the directory exchange does not open the office). Two criteria fail; everything else passes
(see `verdict.json`).

## P1 — AC2: a password form still submits by GET (root «Моя почта», SMTP password), and the guard does not see it

- **Where.** `src/app/root/me/mail-sender-form.tsx:134` — `<form onSubmit={save} className="space-y-5"
  data-mail-sender-form>` has no `method="post"`. Its inputs are rendered by the `field()` helper with `name={key}`
  (`:126`); the SMTP password is `field("password", …, { type: "password", autoComplete: "new-password", … })`
  (`:192-196`). The submit button is `disabled={busy !== null}` — enabled before hydration.
- **Why the guard misses it.** `src/app/password-forms-post.test.ts:25-26` — `PASSWORD_INPUT` only matches JSX
  attribute syntax (`type="password"`, `type={…"password"…}`, `autoComplete="current|new-password"`). Props passed as
  an object literal (`type: "password"`, `autoComplete: "new-password"`) are not matched, so the file is never
  selected and the form passes CI. AC2 requires every form in `src/` whose file has a password input to be
  `method="post"` and a guard that catches a new one.
- **Repro (stand, page bundles blocked = before hydration).** Temp ROOT user → `/root/me` with
  `**/_next/static/chunks/**` aborted → fill host, username, password `SmtpSecret-123` → click «Сохранить».
  Result: form `method` = null, submit enabled, browser navigates to
  `/root/me?fromName=…&host=smtp.example.test&port=465&username=mailer%40example.test&password=SmtpSecret-123&replyTo=…`
  (`passwordInUrl: true`, `passwordInAnyRequestUrl: true`). With JS fully off the streamed page stays hidden, but the
  realistic «scripts still loading» case leaks, exactly like the original `/login` leak.
- **Smallest fix.** Add `method="post"` to that `<form>`; extend `PASSWORD_INPUT` with
  `|type:\s*["']password["']|autoComplete:\s*["'](?:current|new)-password["']` (only this `.tsx` file matches the
  object-literal form today) and add `src/app/root/me/mail-sender-form.tsx` to the «страж видит» list in the same test.

## P2 — AC6: deleting the last object leaves the office, and the office page then offers «Добавить в офис» with no objects

- **Where.** `src/app/api/settings/buildings/[id]/route.ts:106-127` (`DELETE`) removes only the object
  (`:124`); nothing closes the office when the last object goes. After the deploy step every one-object company has
  an office, so one «Удалить объект» (object page danger block or «Объекты» list, no last-object guard) gives
  «office row, no objects» — the state the spec's Decisions exclude («A company with no objects gets no office row»).
  The same state follows an exchange undo after the office page opened the receiving company's office (the undo
  deletes only what the transfer created).
  The office page then renders the full office: `src/app/(dashboard)/settings/organization/office/page.tsx:125`
  `{readOnly || !office ? null : <Link …data-office-staff-add>}` shows «Добавить в офис» next to «Объектов пока нет»,
  while AC6 says «With no objects: … no «Добавить в офис»». The office is also the only building for «first building»
  defaults again (e.g. the new-equipment dialog's place is `defaultBuildingId ?? buildings[0]?.id`,
  `src/components/settings/equipment-dialog.tsx:175`; the room picker's new-room place is `props.buildings[0]?.id`,
  `src/components/cleaning/room-directory-picker-dialog.tsx:85`) — the reason the spec gives for not keeping an office
  without objects.
- **Repro (stand).** Temp company with one object «Кафе у реки», office opened by `openOrganizationOffice` (the
  post-deploy state), owner signs in → `DELETE /api/settings/buildings/<object id>` → 200 → DB: only
  `office:Офис`, `perLocationJournals = true` → `/settings/organization/office`: `[data-office-staff-add]` present,
  text «Объектов пока нет — создайте первый…» (screenshot in the verifier scratchpad, `orphan-office.png`); the
  «Добавить оборудование» dialog treats the office as «этот объект» («В этом объекте пока нет помещений»).
  For contrast, a company that never had objects renders correctly (`officePage: none`, no «Добавить в офис», no
  «не распределены»).
- **Smallest fix.** Either restore the invariant where it breaks — in `DELETE /api/settings/buildings/[id]`, after
  deleting a non-office building, if no non-office building is left, delete the office too (the route already
  deletes an office on request and calls `closePointManagerSessions`; the transfer undo would need the same call) —
  or, as the minimal AC6 fix, treat an office without objects as absent on the office page: hide «Добавить в офис»
  when `points.length === 0` (`!office || points.length === 0`), with a test next to the existing AC3/AC6 guards.
