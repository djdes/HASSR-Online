# Evidence: series E — exchange operations, network manager, network money

**Test bench:** local PostgreSQL 16, `next dev` and Playwright/Chromium.

**Branch:** `claude/eloquent-cray-4wdz2i`. It has master merged in, up to 876b7dfe3 (#290).

**Out of scope:** production was not touched. Item 12 of the proposal (native-speaker review of the uz texts) was excluded by the owner.

**Files:** logs and the live-run script are in `raw/`. The `raw/e0*.jpg` screenshots are matched by `.gitignore` and stay local, as in series D.

The independent review and its fixes are recorded in `problems.md` (items 1–7). Two problems found later are recorded there too: one by CI (item 8), one by the live run (item 9). The results below come from the current code, after all fixes.

## AC1. Alert on exchange failures — PASS

**What happens after a scheduled exchange.** `runAllDirectoryExchanges` calls `alertExchangeProblems` (`alert.server.ts`). It looks for cabinets that failed in this run or have had no successful exchange for 24 hours. If any exist, it sends one message via `notifyPlatformAdmin`, with:
- the number of such cabinets;
- up to 10 names, with owner and error;
- a link to `/root/directory-exchange`.

**At most one message per Moscow day.**
- The mark (AuditLog `directory_exchange.alert`) is written only after the message is delivered.
- A failed send does not break the exchange.
- Names are HTML-escaped.

**Checks.**
- `alert.test.ts`: 5/5.
- `scripts/e2e/cleanup-check.ts` (`raw/cleanup-check.log`), 15/15 in total. It covers:
  - a failure plus "24 hours without success" gives one message;
  - the same day gives nothing more;
  - the next day sends again;
  - a failed delivery leaves no mark and the next call retries;
  - a normal night gives nothing.

## AC2. End-to-end scenarios on PRs — PASS

**Trigger.** `.github/workflows/nightly-e2e.yml` now also runs on `pull_request` to master. It runs when a PR changes any of:
- the exchange, balances, the org's own 14 days, billing;
- `src/lib/account-roles*`, `src/lib/network-*`, `src/app/api/settings/**`;
- `scripts/e2e/**`, the schema, or the workflow file itself.

**Notifications.** Only the scheduled run reports to Telegram, and only it sees the secrets.

**Syntax.** The YAML loads in `yaml` and `js-yaml`.

**Runs on this PR.**
- Runs 2, 3, 5 and 9 passed.
- Run 8 failed in `cleanup-check` because the CI database has no platform organization (problems.md item 8). Fixed and reproduced on a fresh database: `raw/e2e-ci-simulation.log`.

## AC3. Exchange load test — PASS (targets met, except peak memory; reasons and next steps are described)

**Test:** `scripts/e2e/load-exchange.ts`, log in `raw/load-exchange.log`.
- Size: 20 organizations; 5,000 products, 500 employees, 50 sites and 300 pieces of equipment each; 113,810 records created.

**Before the optimisation.** The first exchange took 1,012 s. The exchange lock (10 minutes) expired and the run was recorded as an error. That would have been a real production failure for a large network.

**What was optimised:**
- products are inserted in batches of 200 (`product-batch.server.ts`), written every 1,000;
- names are re-checked in the database right before each batch is written (review item 3);
- `productCreateData` and `cabinetLabels` are loaded in batches.

Behaviour did not change: all exchange scenarios pass.

**After the optimisation:**

| Measure | Target | Result |
|---|---|---|
| First exchange | ≤ 600 s | 362.7 s |
| Repeated exchange | ≤ 60 s | 3.0 s, nothing changed |
| Peak process memory (RSS) | ≤ 1,536 MB | 1,585 MB (previous run: 1,482 MB) |

**About the memory figure.**
- It covers the whole tsx process, which already holds 363–412 MB before the exchange starts.
- At most about 450 MB of the exchange's own memory is actually live; the rest is garbage collected late.
- In production the exchange runs inside `next start` (cron route). The repo sets no PM2 memory limit, and Node's default heap is about 4.1 GB.
- Next steps (in the log): watch `pm2 monit` during a large network's first exchange. If memory runs short, move the scheduled exchange into a separate process, or switch to raw bulk insert.

## AC4. Cleanup of service tables — PASS

During the scheduled exchange (`cleanup.server.ts`) the following are deleted:
- skips not seen for 30 days, and skips of organizations that no longer take part in that list;
- requests from another company that were declined, cancelled or expired more than 180 days ago, and pending requests whose expiry passed long ago;
- one-off transfer records older than 180 days.

The following are not touched:
- approved requests;
- valid pending requests;
- transfers inside the 7-day undo window.

The number of deleted rows is reported in the result of the scheduled run.

**Checks:** `cleanup.test.ts` 3/3, `cleanup-check` 15/15. A repeated cleanup keeps the remaining rows.

## AC5. Network manager — PASS

**Table and setup.** `AccountNetworkManager` stores account, user, who appointed them and when.
- On «Сеть» the owner appoints and removes a manager.
- Only people with full access in the account's organizations can be appointed; ROOT cannot.

**What the manager can do** (the owner's rights):
- the «Сеть» page;
- set up and run the exchange (the «Обмен справочниками» card on «Мастер-кабинеты»);
- one-off transfers and undoing them;
- reviewing skips;
- history and undoing it, only within their own account (review item 2);
- the master-cabinet code;
- the account balance and transfers.

**Owner only:**
- requests from another company;
- appointing managers;
- tariff payment from the account.

**Other rules:**
- Every action is written to the audit log with the manager's name.
- "Войти как" and point-scoped access are refused.
- Removing the manager takes the rights away at once: the role is read from the database on every call.

**Checks:**
- `account-roles.test.ts` 5/5.
- `scripts/e2e/manager-check.ts` 151/151, including undo across accounts and the «Перейти» rule.
- Live run `raw/series-e-live.log`: the owner appoints in the UI; the manager sees «Сеть» with «Перейти» only for their own organization and sees the exchange card; managers and `account-pay` return 403; after removal, sync and export return 403 and «Сеть» disappears from the menu.

**The «оплата» limit (problems.md item 1).** It covers the account-level payment. Paying from one organization's own balance through `/order` stays as before series E: any of that organization's managers can do it.

## AC6. Network summary for a period — PASS

**Page.** On «Сеть» there is a «Сегодня / 7 дней / 30 дней» switch. For each organization, the 7- and 30-day views show:
- the share of days on which the daily journals were filled in or the day was closed;
- the number of journal entries in the period.

Legacy entries are counted in SQL with `GROUP BY` over template and local day (review item 5), up to 50 organizations.

**Export.** Excel (`exceljs`) and PDF (`jsPDF`, DejaVu font).

**Checks:**
- `network-period.test.ts` 6/6, `network-export.test.ts` 6/6.
- `period-digest-check` 39/39: 2,000 sensor-style entries give exact counts by Moscow day.
- Live run:
  - three entries in organization A raised A's 7-day record count by exactly 3; B stayed at 0;
  - the 7-day Excel file has sheet «Сеть», both organizations, and A's row with 3 entries, the same as on the page;
  - the PDF starts with `%PDF-`, is 154 KB and has 1 page;
  - the today Excel file lists both organizations.

## AC7. Weekly exchange digest — PASS

**Recipients.** Once a week (the existing weekly cron) the digest goes to the account owner and the network managers.

**Content, per organization:**
- created and changed in 7 days;
- waiting for review;
- exchange errors;
- a link to the card.

**Delivery:**
- Sent by email and Telegram.
- Sent only when there is something to report.
- The week is claimed atomically: `pg_advisory_xact_lock` plus a mark in one transaction (review item 4). If nothing was delivered, the claim is removed.

**Checks:**
- `weekly-digest.test.ts` 5/5.
- `period-digest-check`:
  - with events, a letter and Telegram go out;
  - an empty week sends nothing;
  - a repeat in the same week sends nothing;
  - two parallel runs give exactly one send;
  - "Telegram not delivered" leaves no mark.

## AC8. «Сеть» in the mini app — PASS

**What it is.** `src/app/mini/network`: a compact list of organizations with today's journals, balance, the org's own 14 days and «Перейти». «Перейти» uses the same `canOpen` rule as the site. The «Сеть» item appears in the mini app's sections for a network of 2+ organizations.

**Live run:**

| Viewer | Result |
|---|---|
| Owner | both organizations, «Перейти» on both, «Сеть» in «Все разделы» |
| Manager | «Перейти» only for their own organization |
| Neither owner nor manager | redirected away; no «Сеть» in the sections |

**Not checked.** The Telegram initData sign-in itself; the page works on the normal session.

## AC9. Collect from the account's organizations and pay — PASS

**Planner** (`account-pay.server.ts`): the shortfall is transferred from the largest balances first, using the existing transfer between own organizations. Then the tariff is paid as usual from the active organization's balance:
- with the same quote and discount as `/order`;
- with the `expectedPriceRub` check;
- with idempotency keys for the charge and each transfer;
- owner only.

**If payment fails after the transfers,** the money stays on the active organization and the message says so. The reminder about the org's own 14 days mentions that the account's balances cover one more point.

**Checks:**
- `account-pay.test.ts` 9/9.
- `scripts/e2e/pay-from-account-check.ts` 68/68:
  - balances, history and plan match the `/order` path;
  - the same key, sequential or 3 in parallel, gives no second charge;
  - a failure after the transfers is covered;
  - an account that is short is refused;
  - a non-owner gets 403.
- Live run, tariff Стандарт, year, 23,880 ₽:
  - with A = 10 and B = 10 there is no button;
  - with A = 7,960 and B = 23,880 the confirmation shows «Перевод … 15 920 ₽» and «Оплата тарифа … 23 880 ₽»;
  - after payment A = 0, B = 7,960, the plan is standard, year, paid until 2027-11-21;
  - the ledger shows transfer_out −15,920, transfer_in +15,920 and subscription_charge −23,880.

## AC10. Scenarios without duplicates — PASS

**Wrappers.** 15 scripts in earlier tasks' `raw/` folders became wrappers around `scripts/e2e/<name>.ts` (`raw/wrappers-check.log`). The four series E scenarios also live in `scripts/e2e/`, with wrappers in this task's `raw/`.

**The full set (`npm run e2e:exchange`):**

| Where | Result |
|---|---|
| Local database (`raw/e2e-run-all.log`) | 19 of 19 scenarios, 985 checks passed, 0 failed |
| Fresh CI-like database (`raw/e2e-ci-simulation.log`) | the same |
| PR CI | green |

## AC11. Schema, texts and checks — PASS

| Check | Result |
|---|---|
| Schema | additions only: the new `AccountNetworkManager` table (`scripts/apply-safe-schema.cjs` applies it on deploy) |
| ru/en/uz texts | in the same commits; `npm run i18n:check` 101/101 |
| `npm run typecheck` | clean |
| `npx eslint` on the series' 67 changed files | clean |
| `npm run test:gate` | ran the full suite (schema changed): 6,993 passed, 0 failed, after all fixes and after merging master (#290) |
| `npm run e2e:exchange` | 19/19 |
| Live run (`raw/series-e-live.cjs`) | 35 PASS, 0 FAIL; the first run was 34/1, see problems.md item 9 |

## What the deploy changes

- **Database:** a new `AccountNetworkManager` table, added by `apply-safe-schema` with no data migration.
- **Scheduled exchange:**
  - tidies up the service tables;
  - sends the ROOT alert at most once a day;
  - writes products in batches.
- **Weekly cron:** also sends the exchange digest.
- **CI:** the e2e workflow also runs on PRs.
