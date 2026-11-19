# Telegram notification for a webmaster reply

- AC1. The GoGetLinks background sync sends Telegram alerts about new inbound messages in WeSetup campaign chats, including personal chats. Messages fetched earlier by manual sync or by opening a conversation remain eligible.
- AC2. Each reply is claimed once across overlapping runs. Failed delivery can retry, and outgoing messages and other projects are excluded. Reuse established admin and SEO Telegram recipients.
- AC3. Automated coverage verifies routing, deduplication and recovery. Typecheck and the targeted test gate pass. Verify production configuration without sending a test message to real recipients.
