# Overwrite fix D: problems found by the independent verifier

All six acceptance criteria pass on the current code (see verdict.json). The
problems below don't block the frozen ACs. They are side effects or leftover
gaps of the same bug class, listed most severe first.

## 1. Intensive cooling: the form says "Save changes" to edit a row, but submitting adds a new row

- Files:
  - `src/lib/tasksflow-adapters/intensive-cooling.ts:190-207` (`getTaskForm` prefills from a row where `sourceRowKey === rowKey`)
  - `src/lib/tasksflow-adapters/intensive-cooling.ts:77-78` (the submit label becomes "Сохранить изменения" whenever there is a prefill)
  - The key changes at `src/app/api/task-fill/[taskId]/route.ts:214` and `src/app/api/integrations/tasksflow/complete/route.ts:172`.
- Why it happens: the task page (`src/app/task-fill/[taskId]/page.tsx:383`) and the TasksFlow form endpoint (`src/app/api/integrations/tasksflow/task-form/route.ts:58`) still call `getTaskForm` with the link key `employee-<id>`. Submissions now write rows with `employee-<id>#tf-<ms>`. New rows can never be prefilled, and the "open and correct" behaviour described in the code comment no longer works. A row written before the deploy still has `sourceRowKey === "employee-<id>"`, and it matches on every later form open.
- Scenario:
  1. Before the deploy, cook u1 recorded "Борщ" through the task. The row has `sourceRowKey: "employee-u1"`.
  2. After the deploy, u1 opens the same task. The form is filled with Борщ's values and the button reads "Сохранить изменения".
  3. u1 corrects the end temperature and submits. The result is a new row dated today with Борщ. The old row keeps the wrong temperature.
  4. The same thing happens on every open until the document period ends.
- Smallest fix: in `intensiveCoolingAdapter.getTaskForm`, pass `null` as the prefill. Every submission is now a new row, so the form should open empty. Alternatively, prefill only when `rowKey` carries a `#tf-`/`#qr-` suffix.

## 2. A retried TasksFlow `/complete` can now create a duplicate brakerage, perishable or cooling row

- Files: `src/lib/tasksflow-adapters/row-key.ts:48-51` (the suffix comes from `Date.now()`) and `src/app/api/integrations/tasksflow/complete/route.ts:126-172` and `:249`. Deduplication relies on an AuditLog row, which is written only after apply.
- Scenario:
  1. TasksFlow `/complete-with-values` posts to WeSetup with a 30 s `AbortSignal.timeout`, then queues a retry with the same payload.
  2. If the first WeSetup request is slow (for example, waiting on the document lock) or fails between `applyRemoteCompletion` and `auditLog.create`, the retry misses the dedup.
  3. The retry gets a fresh `#tf-<now>` key, so finished_product, perishable_rejection or intensive_cooling gets a second identical row.
- Before the fix, the shared `employee-<id>` key made the retry upsert the same row. The pure append adapters already had this problem; it now also reaches the three upsert journals.
- Smallest fix: in the `/complete` route, derive the suffix from the request's `eventId` instead of the clock. For example, `rowKeyForTaskSubmission(code, key, parseInt(eventId.slice(0, 12), 16))`. The current suffix regex (`\d+`) still matches. The same payload then always maps to the same row, and different payloads still get different rows.

## 3. External API row merge still lets a request overwrite `signatures` and `sourceRowKey`

- File: `src/lib/external/config-patch.ts:41-42` (`next[at] = { ...existing, ...item }`).
- Scenario: a client reads the document while row A is unsigned. The committee then signs row A on the site. The client posts `data.rows: [{ ...rowAAsRead, note: "x" }]`, which includes `signatures: []`. The merge keeps the client's empty array, and the committee's signature disappears.
- The opposite also works: a client can attach arbitrary `signatures` to a row. The web PATCH path blocks both through `SERVER_OWNED_ROW_KEYS` in `src/lib/brakerage-row-merge.ts:34`.
- This isn't a regression: before the fix, `rows` replaced everything. It is the same lost-update class, and AC4's own example field ("e.g. signatures") only survives when the client omits it.
- Smallest fix: in `mergeRecordList`, for each matched row, copy `signatures` and `sourceRowKey` from `existing` over the merged row. For new rows, drop those keys from `item`.

## 4. TasksFlow `/complete` with `values: {}` still resets an audit-plan row (residual of AC2's intent)

- Files: `src/lib/tasksflow-adapters/audit-plan.ts:109` and `src/app/api/integrations/tasksflow/complete/route.ts:92-101`.
- Why it happens: AC2 lists only pull and webhook, and both pass `values === undefined`. TasksFlow's verify-approve sends `{ values: savedValues }`, which is `{}` when the task was finished without a form (`C:/www/TasksFlow/server/routes/task-status.ts:365-390`). `/complete-with-values` sends `values ?? {}`. The audit-plan form has no required field, so `{}` passes the validator and reaches the adapter. `!values` is false for `{}`, so the row gets `checked: false` and an empty auditor comment, wiping what the auditor entered.
- Audit protocol (`result` is required) and training plan (`plannedDate` is required) reject `{}` with a 400, so they aren't affected. This behaviour existed before the fix; the change didn't introduce it.
- Smallest fix: in audit-plan, treat an empty values object like a missing one: `if (!completed || !values || Object.keys(values).length === 0) return false;`.

## 5. Low: a lock transaction can wait on a second pool connection

- Files: for example `src/lib/tasksflow-adapters/acceptance.ts:111`, `intensive-cooling.ts:221` and the other converted adapters, plus `journal-responsibles-cascade.ts:528` (`cascadeOrgDataFor`).
- Why it happens: `findTaskEmployee` (and `fetchOrgDataForDefaults` in the cascade) runs on the global `db` pool while the `FOR UPDATE` transaction already holds a connection. `pg.Pool` is created without `max` (`src/lib/db.ts:45`), so the default of 10 applies.
- Scenario: about 10 submissions arrive at once. Each transaction holds one connection and waits for a second, so the pool starves until the 15 s transaction timeout aborts them with 500s.
- `appendFinishedProductRows` already used this pattern (the inspector lookup), so the risk isn't new, but the change spreads it to about 13 more adapters.
- Smallest fix: resolve the employee before the lock, using the organisation from a light pre-read as `finished-product.ts:253` does. `organizationId` never changes, so that read can't go stale.

---

## Resolution (builder, after verification)

All five problems were fixed in the follow-up commit. Each fix has a regression test:

1. `intensive-cooling.ts` `getTaskForm` no longer prefills from the row keyed by the task key: the form always opens empty and says «Сохранить замер». Test: `config-lock.test.ts` «форма задачи открывается пустой…».
2. `complete/route.ts`: the `#tf-` suffix comes from `eventId` (sha256 of the payload, first 48 bits) instead of the clock. A TasksFlow retry that arrives before the dedup audit row exists lands in the same row; different payloads still get different rows. Test: `tasksflow-task-submission-rowkey.test.ts` «повтор того же запроса…».
3. `config-patch.ts`: `signatures` and `sourceRowKey` are server-owned. A matched row keeps the stored values, and a new row from the request doesn't get them. Test: `config-patch.test.ts` «подписи и ключ источника строки — серверные…».
4. In all six guarded adapters an empty `values` object now counts as no values. Test: `config-lock.test.ts` no-values cases now also call with `values: {}`.
5. The employee lookup (`findTaskEmployee`) now runs before `withDocumentConfigLock` in the 11 adapters that did it inside, using a light `organizationId` pre-read, as `finished-product` does. Test: the fake lock counts lookups made while the lock is held, and all 19 fixtures assert 0. Left as is, deliberately: `appendFinishedProductRows` already looked up the inspector inside the lock before this change, and the cascade calls `cascadeOrgDataFor` only for empty configs. The cascade runs documents one at a time, so it holds at most one lock transaction.
