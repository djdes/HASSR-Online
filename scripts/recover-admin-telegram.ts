import "dotenv/config";
import { db } from "../src/lib/db";
import { getInboundBot } from "../src/lib/bot/bot-app";
import { getPlatformAdminChatIds, notifyPlatformAdmin } from "../src/lib/platform-admin";
import { retryDelayMs } from "../src/lib/telegram";
import { recoverAdminTelegramMessages } from "../src/lib/admin-telegram-recovery";

async function main() {
  const args = process.argv.slice(2);
  const sinceIndex = args.indexOf("--since");
  if (sinceIndex === -1 || !args[sinceIndex + 1]) throw new Error("--since YYYY-MM-DD is required");
  const since = new Date(args[sinceIndex + 1]);
  if (!Number.isFinite(since.getTime())) throw new Error("Invalid cutoff date");
  const chatIds = getPlatformAdminChatIds();
  if (!chatIds.length) throw new Error("Administrator recipients are not configured");
  const rows = await db.telegramLog.findMany({
    where: { chatId: { in: chatIds }, status: { in: ["failed", "rate_limited"] }, createdAt: { gte: since } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, chatId: true, body: true, status: true, createdAt: true, kind: true },
  });
  const summary = {
    deliveries: rows.length,
    attachments: rows.filter(row => row.body.startsWith("[attachment]")).length,
    byKind: Object.fromEntries([...new Set(rows.map(row => row.kind ?? "unclassified"))].map(kind =>
      [kind, rows.filter(row => (row.kind ?? "unclassified") === kind).length])),
    recipients: Object.fromEntries(chatIds.map(id => [`…${id.slice(-4)}`, rows.filter(row => row.chatId === id).length])),
  };
  console.log(JSON.stringify({ mode: args.includes("--send") ? "send" : "preview", ...summary }));
  if (!args.includes("--send")) return;
  if (summary.attachments) throw new Error("Restore attachment files separately before replaying their audit rows");
  const bot = getInboundBot();
  if (!bot) throw new Error("Bot is not configured");
  await bot.api.getMe();
  if (rows.length) await notifyPlatformAdmin("✅ Связь с Telegram восстановлена. Ниже — уведомления, которые не доставились с 30 сентября. На обращения отвечайте свайпом на соответствующее сообщение.", { kind: "recovery-info" });
  const result = await recoverAdminTelegramMessages(rows, { chatIds, since }, {
    async claim(row) {
      const claimed = await db.telegramLog.updateMany({
        where: { id: row.id, chatId: row.chatId, status: row.status, createdAt: { gte: since } },
        data: { status: "queued" },
      });
      return claimed.count === 1;
    },
    async send(row, text) {
      for (let attempt = 1; ; attempt++) {
        try {
          await bot.api.sendMessage(row.chatId, text, { parse_mode: "HTML" });
          return;
        } catch (error) {
          const delay = retryDelayMs(error, attempt);
          if (attempt >= 3 || delay === null) throw error;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    },
    async markSent(row) {
      await db.telegramLog.update({ where: { id: row.id }, data: { status: "sent", error: null, sentAt: new Date(), attempts: { increment: 1 } } });
      const reportId = row.body.match(/#fb_([A-Za-z0-9_-]+)/)?.[1];
      if (reportId) await db.feedbackReport.updateMany({ where: { id: reportId, adminTgNotifiedAt: null }, data: { adminTgNotifiedAt: new Date() } }).catch(() => console.error("Feedback delivery flag update failed; Telegram delivery is already confirmed"));
    },
    async markFailed(row, uncertain) {
      await db.telegramLog.update({ where: { id: row.id }, data: { status: uncertain ? "recovery_uncertain" : "failed", error: uncertain ? "Delivery confirmed; recovery acknowledgement failed" : "Backlog recovery delivery failed", attempts: { increment: 1 } } });
    },
    pause: () => new Promise(resolve => setTimeout(resolve, 1100)),
    progress(result) {
      if ((result.sent + result.failed + result.uncertain) % 10 === 0) console.log(JSON.stringify({ progress: result }));
    },
  });
  console.log(JSON.stringify({ recovered: result }));
  if (result.failed || result.uncertain || result.skipped) process.exitCode = 1;
}

main().catch(() => { console.error("Administrator backlog recovery failed; inspect delivery statuses without exposing tokens or message bodies"); process.exitCode = 1; })
  .finally(() => db.$disconnect());
