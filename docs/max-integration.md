# MAX ↔ WeSetup

Self-service connection: `/max/connect`. Organization settings: `/settings/integrations/max`. Entry: `/max`. Personal journals: `/max/journals`. Webhook: `/api/max/webhook`.

The implementation uses the official [bot API](https://dev.max.ru/docs/chatbots/bots-coding/prepare), [signed launch validation](https://dev.max.ru/docs/webapps/validation), [webhook subscription contract](https://dev.max.ru/docs-api/methods/POST/subscriptions) and [group admin verification](https://dev.max.ru/docs-api/methods/GET/chats/-chatId-/members/admins).

## Configuration

Set these only in the server's secret environment (never `NEXT_PUBLIC_*`):

```dotenv
MAX_BOT_TOKEN=<bot token>
MAX_BOT_USERNAME=<bot username without @>
MAX_WEBHOOK_SECRET=<random 32+ character secret>
MAX_SITE_URL=https://wesetup.ru
MAX_API_BASE_URL=https://platform-api2.max.ru
```

The API currently documents `platform-api2.max.ru` and requires the Ministry of Digital Development CA to be trusted. Install the official CA bundle for Node using `NODE_EXTRA_CA_CERTS=/absolute/path/to/official-ca-bundle.pem`, and restart the process. Do not disable certificate validation. `https://platform-api.max.ru` remains an explicitly configurable compatibility endpoint; the supplied token was verified there during development because this workstation does not yet trust the new endpoint's issuer. Retest against the recommended endpoint on the server.

## Activation after deployment

1. Deploy the reviewed source, generate Prisma client, apply the additive MAX schema changes using the normal reviewed database deployment process, build and restart. Existing Telegram configuration is independent.
2. Set the environment variables above on the server. Keep the token out of command-line arguments, Git and logs.
3. Run `npx tsx scripts/setup-max.ts` for a read-only check. It prints only public bot identity and configuration status.
4. Run `npx tsx scripts/setup-max.ts --apply` to register the webhook and commands. It does not delete other subscriptions. Ensure this bot is dedicated to WeSetup; another active consumer could receive the same events.
5. In the MAX business console, enable the bot's mini-app and set its URL to `https://wesetup.ru/max`. This console operation requires the bot owner. Basic bot links also provide a browser entry with a one-use handoff.
6. Open WeSetup as an existing user, click MAX in the top-right toolbar or on a hygiene QR form, open the bot and return to confirm the displayed identity. In MAX press «Готово» or send `/menu`. Test organization switching, one journal and a ROOT account separately.
7. To connect an organization group, first connect the manager personally. Add the bot as group admin, generate the organization command, send it from the same manager's MAX account (also a group admin), and confirm the group on the site.

## Access and security

- A signed-in person creates a 10-minute token. The webhook only nominates a MAX identity. The original site session explicitly confirms it. Unique DB constraints prevent a MAX account being moved silently to another person.
- Tokens are stored as SHA-256 hashes. Login links expire in two minutes, are consumed atomically once, and recheck active user, link and organization membership. A disconnected identity invalidates outstanding handoffs. Unlinking terminates the user's sessions so already-issued MAX sessions cannot survive.
- Native launch data uses the official WebAppData HMAC algorithm, unique keys, constant-time comparison and a five-minute age limit. Existing Telegram two-factor confirmation remains mandatory: such accounts must sign in through the existing login form.
- ROOT comes exclusively from `User.isRoot`. A ROOT entry into an organization uses the existing impersonation claim/banner. Settings require live organization management rights. No bot identity grants privileges by itself.
- Kiosk and partner sessions cannot attach personal identities. Group chats never receive private login links, journal menus or staff lists.
- Bot menus load current journal ACL, disabled journals, organization membership and permissions. Journal links recheck current access before opening existing journal/QR forms; forms retain their own checks. No duplicate fill engine or TasksFlow synchronization is introduced.
- Webhooks fail closed without their secret and use a persisted lease to handle parallel deliveries and crash retries. Invalid JSON fails before business logic. Delivery failures return 503 so MAX can retry. A process crash after sending a message but before persisting completion can repeat that message; account/link mutations remain protected by transactions.
- MAX bearer links use URL fragments; the entry screen removes the fragment before exchange and MAX pages are excluded from analytics. Responses containing credentials use no-store.
- MAX Web's framed entry is allowlisted only for `https://max.ru` and `https://web.max.ru`. After signed authentication it offers a one-use link to open WeSetup in a separate browser tab. This preserves the site's existing frame and session-cookie protections and works without relying on third-party cookies. Native MAX opens the cabinet directly.

## Retention

Delete expired `MaxLinkRequest` and `MaxSessionHandoff` rows after one day, and completed `MaxWebhookReceipt` rows older than 30 days during the site's scheduled maintenance. `npx tsx scripts/cleanup-max.ts` performs this bounded cleanup. It does not delete identities or organization settings.

## Verification

`node --import tsx --test src/lib/max/*.test.ts`, `npm run typecheck`, scoped ESLint and a browser smoke test. See `.agent/tasks/max-integration-20261024/` for the frozen spec, current evidence and remaining external activation items.
