# GoGetLinks Telegram verification

- AC1. The cron checks synced inbound messages in the WeSetup campaign after completing chat sync. Persisted messages remain eligible regardless of which chat entry point imported them.
- AC2. The regression verifies campaign and direction filtering, Telegram-only options, retries after failure and deduplication across overlapping runs. Production already has the cron, Telegram bot and configured recipients.
- AC3. PASS. Fresh npm run typecheck and npm run test:gate passed (7 tests). Production configuration was checked without sending a test notification.
