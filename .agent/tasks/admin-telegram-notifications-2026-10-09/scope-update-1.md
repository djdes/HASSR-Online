# Scope update 1 — owned proxy and backlog recovery

Frozen: 2026-10-09 before proxy implementation and backlog writes.

The owner provided a private HTTP/SOCKS5 proxy and explicitly authorized using it, without Cloudflare. The owner also requested sending all accumulated notifications so they can reply. This supersedes the earlier constraint against bulk history replay for administrator notifications.

- AC7: Both inbound and outbound bot clients, attachments and health checks use the supplied proxy, with TLS validation retained and credentials kept out of logs/artifacts/git. Do not use Cloudflare.
- AC8: Recover persisted administrator notifications that failed during the outage, to their original configured administrator recipients; preserve support reply anchors and record successful delivery. Do not resend already delivered messages or message customer chats. Preserve Telegram pending incoming updates on restart. Provide counts and explicit limits for any history that is unavailable.

Implementation remains bounded to Telegram transport, the poller, health monitoring, a scoped recovery utility and supporting documentation/tests. No customer registration or tenant data edits are authorized by this update.
