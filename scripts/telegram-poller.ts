/**
 * Telegram long-polling fallback.
 *
 * Зачем нужен: nginx на проде из-за round-robin-конфига роутит
 * ~50% входящих webhook-ов на мёртвый upstream `wesetup.ru3` →
 * Telegram получает timeout → отдаёт пользователю 503 Tunnel
 * Unavailable. Править nginx без sudo я не могу, поэтому
 * отказываемся от webhook'а и тянем updates сами через
 * `bot.start()` (long-polling, direct до api.telegram.org
 * через TELEGRAM_FORCE_IP).
 *
 * Запускается отдельным PM2 процессом `haccp-telegram-poller`.
 * Использует тот же grammy Bot из `src/lib/bot/bot-app.ts` —
 * handlers и config re-used, нет дублирования кода.
 *
 * Webhook перед стартом автоматически удаляется grammy (внутри
 * bot.start()).
 */

import "dotenv/config";
import { getInboundBot, ensureBotInit } from "@/lib/bot/bot-app";

async function main() {
  const bot = getInboundBot();
  if (!bot) {
    console.error("[poller] TELEGRAM_BOT_TOKEN не настроен");
    process.exit(1);
  }
  console.log("[poller] ensureBotInit…");
  await ensureBotInit(bot);
  console.log("[poller] bot ready, starting long-polling");

  const shutdown = () => {
    console.log("[poller] stopping…");
    bot.stop();
    setTimeout(() => process.exit(0), 1500);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  // Keep pending support messages when connectivity returns after an outage.
  await bot.start({
    drop_pending_updates: false,
    allowed_updates: [
      "message",
      "callback_query",
      "inline_query",
      "my_chat_member",
    ],
    onStart: (info) => {
      console.log(`[poller] @${info.username} (id=${info.id}) online`);
    },
  });
}

main().catch((err) => {
  console.error("[poller] fatal:", err);
  process.exit(1);
});
