# MAX ↔ WeSetup

Everything happens in the chat with the bot: no mini-app, no browser login links. Webhook: `/api/max/webhook`. Site pages are only for a manager's personal link (`/max/connect`) and organization settings (`/settings/integrations/max`).

The implementation uses the official [bot API](https://dev.max.ru/docs/chatbots/bots-coding/prepare): messages with inline keyboards, [callback answers](https://dev.max.ru/docs-api/methods/POST/answers) that replace the pressed message, the [webhook subscription contract](https://dev.max.ru/docs-api/methods/POST/subscriptions) and [group admin verification](https://dev.max.ru/docs-api/methods/GET/chats/-chatId-/members/admins).

## How people use it

**Employee** (`/start`, `/menu`): greeting with today's progress («заполнено 2 из 4»), a one-tap button for the next unfilled journal, «Мои задачи на сегодня», «Все журналы», «Как это работает», organization switch when there are several.

**Filling a journal**: one question per message, the bot edits the same message as you go.
1. Document (several active documents, e.g. per location) and row (row-based journals) are picked by buttons; a single one is picked automatically.
2. Each field of the journal's adapter form (`src/lib/tasksflow-adapters`): yes/no and lists — buttons; numbers and text — a reply message (quick values from the norm, «Оставить: …» for today's value, recent names); date — «Сегодня/Вчера»; time — «Сейчас», «−15 мин» …; signature — «Подписать: ФИО»; optional — «Пропустить». Object readings have «Выключено / Нет показания». Out-of-norm value → «Что вы сделали?» with ready answers.
3. Review: «Сохранить», «Изменить» (pick a field, then back to review), «Отменить». Every step has «‹ Назад» and «✖ Отменить».
4. Saved: «✅ Записано», «➕ Добавить ещё» for row journals, «✍️ Следующий: …».

Fridges, warehouses and UV lamps stay sticker-only (decision 33d8559b): the bot explains how to scan the object's QR.

**Manager** (management role, `canManageSettings` or ROOT in the active organization) additionally gets:
- «📊 Сводка за сегодня» — filled/total and who has not filled what (marks people not in MAX);
- «🔔 Напомнить не заполнившим» — confirmation, then a personal message with their journals and a «Заполнить» button to each connected employee; at most once per 30 minutes per organization (`MaxOrganizationIntegration.lastReminderAt`);
- «👥 Подключить сотрудника» — staff without MAX → a personal one-time link `https://max.ru/<bot>?start=inv_…` (7 days) sent as a separate message to forward. The employee taps it and is linked immediately; the manager is notified. If the deep link does not trigger the bot, the employee can send the `inv_…` code as a message.

Filling is possible in the user's home organization (the write core records staff of that organization). In other organizations a manager sees the summary, reminders and invites.

## Configuration

Set these only in the server's secret environment (never `NEXT_PUBLIC_*`):

```dotenv
MAX_BOT_TOKEN=<bot token>
MAX_BOT_USERNAME=<bot username without @>
MAX_WEBHOOK_SECRET=<random 32+ character secret>
MAX_SITE_URL=https://wesetup.ru
MAX_API_BASE_URL=https://platform-api2.max.ru
```

The API documents `platform-api2.max.ru` and requires the Ministry of Digital Development CA to be trusted. Install the official CA bundle for Node using `NODE_EXTRA_CA_CERTS=/absolute/path/to/official-ca-bundle.pem`, and restart the process. Do not disable certificate validation. `https://platform-api.max.ru` remains an explicitly configurable compatibility endpoint.

## Activation after deployment

1. Deploy from master (the workflow runs `prisma db push`: additive columns `MaxIdentity.botState`, `MaxIdentity.botStateAt`, `MaxOrganizationIntegration.lastReminderAt` and the new table `MaxInvite`).
2. Set the environment variables above on the server. Keep the token out of command-line arguments, Git and logs.
3. `npx tsx scripts/setup-max.ts` — read-only check (bot identity, webhook status).
4. `npx tsx scripts/setup-max.ts --apply` — registers the webhook and the commands `/menu`, `/tasks`, `/journals`, `/help`. It does not delete other subscriptions; the bot must be dedicated to WeSetup. No mini-app setting is needed in the MAX business console.
5. A manager links their own MAX once on the site (MAX icon → «Связать мой MAX» → open the bot → confirm on the site). Then in the bot: «👥 Подключить сотрудника» → forward the link → the employee taps it.
6. Smoke test on a phone: employee fills hygiene and one row journal (e.g. finished product), an out-of-norm number, «Изменить», «Отменить»; manager checks «Сводка» and «Напомнить».
7. Optional organization group: connect the manager personally, add the bot as group admin, generate the command on the site, send it in the group from the same manager (also a group admin), confirm on the site. Groups never receive personal menus.

## Access and security

- Site linking: a signed-in person creates a 10-minute token; the webhook only nominates a MAX identity, the original site session confirms it.
- Employee invites (`src/lib/max/invite.ts`): 24 random bytes, only the SHA-256 hash is stored, single use (atomic `usedAt`), 7 days, a new invite replaces the previous one. Only an active, non-archived employee of the issuing organization; issued only by a manager of that organization. A MAX account linked to someone else, or an employee with a different MAX, is refused — nothing is relinked silently.
- Every press re-checks the link, the account (active, not archived), organization membership and whether MAX is enabled for it, the journal ACL (`canWriteJournal`), the `journals.fill` permission and disabled journals.
- Writes go through `submitJournalFill` (same core as QR forms) with `messenger: { channel: "max" }`: the employee is the linked person (no PIN or site session needed, own name only), the rate limit is per MAX user, the audit log records `channel: "max"`.
- Dialog state lives in `MaxIdentity.botState` with `botStateAt`, expires after 2 hours. Buttons carry the wizard id and a sequence number: presses from older messages never write. «Сохранить» clears the state with a compare-and-swap before writing, so a double tap cannot create two entries.
- Webhooks fail closed without their secret and use a persisted lease for parallel deliveries and crash retries. Delivery failures return 503 so MAX retries. No upstream payloads, tokens or Prisma errors are logged.
- Unlinking (site or stopping the bot) removes the identity and ends the user's site sessions, as before.

## Retention

`npx tsx scripts/cleanup-max.ts` deletes expired `MaxLinkRequest`, `MaxInvite` and legacy `MaxSessionHandoff` rows after one day, and completed `MaxWebhookReceipt` rows older than 30 days. It does not delete identities or organization settings.

## Verification

`node --import tsx --test src/lib/max/*.test.ts`, `npm run typecheck`, `npm run test:gate`, scoped ESLint. See `.agent/tasks/max-bot-only-2026-10-26/` for the frozen spec and evidence.
