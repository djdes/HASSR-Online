# Spec: office-default-login-leak-2026-11-24

Status: FROZEN (2026-11-24)

## Request (owner, 2026-11-24, screenshot of /settings/organization/office with «Выделите офис»)

> удали ветку и исправь утечку пароля при входе. а так же "Выделить офис" убери и сделай по умолчанию всем с
> офисом, организации у которых не выделено открой

1. Delete the merged task branch `claude/amazing-bohr-s3zvbx`.
2. Fix the login password leak found in the previous task: pressing «Войти» before the page scripts load sends
   `GET /login?email=…&password=…` — the credentials land in the address bar, browser history and server logs.
3. Remove «Выделить офис»; the office is the default for every company; open it for companies that do not have it.

## Decisions

- **Branch.** The session git proxy refuses branch deletion (HTTP 403, policy). It is reported to the owner, not
  worked around. The new work restarts the same branch name from fresh `origin/master` (the harness requires it); the
  owner deletes it on GitHub after the merge (the PR page button).
- **When the office row exists.** «Открыть офис» = what the «Выделить офис» button did: an office building
  (`kind = "office"`, name «Офис», company address and phone) and journals by objects (`perLocationJournals`).
  A company with **no objects** gets no office row: its only building would be the office, and every «first / only
  building» default (new rooms, areas, equipment, onboarding rooms) would put things into the office. Its office page
  shows the office content anyway (management, «Создать объект»), and the office opens together with the first
  object, whatever creates it. A company **with objects** always has an open office.
- **Existing companies.** One-shot data step on deploy, owner's instruction («организации у которых не выделено
  открой»): after the new build passes its health check, like the office-journals transfer: `--dry-run` totals, then
  the change; once-key; audit log per company; totals only in the public Actions log.
- **Split toggle.** «Вести журналы отдельно по точкам» on «Объекты» becomes a trap once the office is the default
  (turning it off leaves an office without objects split and no way back): hidden while the office exists; the API
  refuses to turn it off while the office exists.
- **Sessions.** As the button did: managers bound to objects get a new session version (re-login) when a company's
  office opens, because their access narrows to their objects.

## Acceptance criteria

- **AC1 — Login never puts credentials into the URL.** The credentials forms of `/login`, `/mini/login`,
  `/invite/[token]`, `/join/[token]`, `/pair/[token]` use `method="post"`, and their submit button stays disabled
  until the page is hydrated: a click or Enter before the scripts load sends nothing and the URL stays clean. After
  hydration sign-in works as before. Proof: browser with page scripts blocked (no hydration) — fill, click, Enter: URL
  without `email`/`password`, no request carries them in a URL; normal browser — sign-in succeeds.
- **AC2 — No password form can leak through GET.** Every `<form>` in `src/` whose file has a password, PIN or secret
  input (`type="password"`, `autoComplete="current-password" | "new-password"`) has `method="post"`. A guard test
  scans `src/` so a new password form without it fails CI.
- **AC3 — «Выделить офис» is gone.** The office page never shows the «Выделите офис» card or «Сначала добавьте
  объект»; the button component, `POST /api/settings/office`, `officeSetupState` and the texts
  `settingsManagement.office.create.*` / `settingsManagement.office.disabled.*` are removed from ru/en/uz.
- **AC4 — The office opens with the first object, on every path.** Creating an object by any path — the «Объекты»
  page (`POST /api/settings/buildings`), the onboarding template, the registration questionnaire (locations ≥ 2), the
  demo company, the directory exchange — leaves the company with an office and journals by objects. A guard test lists
  every `building.create` site in `src/` and requires the open-office call next to it.
- **AC5 — Existing companies are opened on deploy.** `prisma/seed-open-office-2026-11.ts`: every regular company
  (not the platform company, not a directory master cabinet) with at least one object and without an open office
  gets: the office building if missing, `perLocationJournals = true`, a new session version for managers bound to
  objects, and an audit log entry `building.office_opened` (office id, created or existing, journals-by-objects
  before). Companies without objects are not touched. `--dry-run` prints totals and changes nothing; the real run
  prints the same totals; the once-key `once:open-office:v1` stops a second run. `deploy.yml` runs it after
  `post-deploy-check.sh`, outside the prisma-hash and legacy blocks, dry-run first, failure does not stop the deploy.
- **AC6 — The office page works for every company.** It always shows «Руководство», «Журналы ведутся на объектах»,
  «Объекты компании» and «Оборудование объектов». With no objects: empty blocks with «Создать объект», no «Добавить
  в офис», no «не распределены» warning. With objects but no open office (a company created before the deploy step
  ran): the page opens the office on visit (not in a read-only partner view).
- **AC7 — The office is never a default place.** New areas and equipment default to the only object, never to the
  office; the default area of the equipment directory and `soleBuildingId` skip the office; onboarding template rooms
  go to an object («Основная точка» is created when there is none), not to the office; the questionnaire creates N
  objects no matter the office; onboarding progress counts objects, not the office; tariff counts stay as they are
  (the office is not counted).
- **AC8 — Journals stay whole.** A company switched to journals by objects keeps its current general documents
  (visible on its objects), and auto-creation makes no per-object duplicate for the current period (the
  `buildingWhere` guard); the toggle on «Объекты» is hidden while the office exists and
  `PATCH /api/settings/buildings { perLocationJournals: false }` answers 400 while the office exists.
- **AC9 — Checks.** `npm run typecheck`, `npm run test:gate`, `npm run i18n:check`, eslint on changed files (no new
  findings vs master), stand UI (desktop light and dark, phone), deploy log with the open-office totals after merge.

## Out of scope

- Changing who works where (no staff is moved to the office by the deploy step).
- Moving existing general documents to objects.
- Companies without objects: no office row until the first object (see Decisions).
