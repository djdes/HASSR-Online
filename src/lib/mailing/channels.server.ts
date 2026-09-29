import { db } from "@/lib/db";
import { isMobilePushConfigured, sendMobilePushToUser } from "@/lib/mobile-push";
import { toMiniUrl, upsertNotification } from "@/lib/notifications";
import { isWebPushConfigured } from "@/lib/web-push";

import type { ChannelSenders, OutgoingInApp, OutgoingPush, OutgoingTelegram, SendOutcome } from "./queue";
import { mailingDryRunDir, sendMarketingEmail, writeDryRunFile } from "./transport.server";

/**
 * Боевые отправители рассылки по каналам.
 *
 *   • письмо — `transport.server.ts` (отдельный SMTP / основной / сухая);
 *   • колокольчик — `upsertNotification` без собственного push: push —
 *     отдельная галочка, одно событие не должно будить дважды;
 *   • push — веб-push (VAPID) и приложение (Firebase). Честно: не
 *     настроено или нет устройств — «пропущено» с причиной;
 *   • Telegram — `sendTelegramMessage` (тихие часы, ретраи, TelegramLog).
 *
 * `MAILING_DRY_RUN_DIR` задан — push и Telegram тоже не уходят наружу:
 * сообщение пишется `.json` в папку сухой отправки. Колокольчик — запись в
 * нашу базу, он работает и в сухом режиме.
 */

export function telegramBotConfigured(): boolean {
  return Boolean((process.env.TELEGRAM_BOT_TOKEN ?? "").trim());
}

export type PushAvailability = {
  webConfigured: boolean;
  appConfigured: boolean;
};

export function pushAvailability(): PushAvailability {
  return { webConfigured: isWebPushConfigured(), appConfigured: isMobilePushConfigured() };
}

/** Почему push этому человеку не уйдёт; null — уйдёт хотя бы на одно устройство. */
export function pushSkipReason(avail: PushAvailability, webSubs: number, appDevices: number): string | null {
  const webTargets = avail.webConfigured ? webSubs : 0;
  const appTargets = avail.appConfigured ? appDevices : 0;
  if (webTargets + appTargets > 0) return null;
  if (webSubs + appDevices === 0) return "Нет подписки на push и приложения с уведомлениями";
  if (appDevices > 0 && !avail.appConfigured && webSubs === 0) {
    return "Приложение установлено, но Firebase не настроен — push в приложение не уходит";
  }
  return "Push не настроен на сервере";
}

async function sendInApp(msg: OutgoingInApp): Promise<SendOutcome> {
  let organizationId = msg.organizationId;
  if (!organizationId) {
    const user = await db.user.findUnique({ where: { id: msg.userId }, select: { organizationId: true } });
    organizationId = user?.organizationId ?? null;
  }
  if (!organizationId) return { kind: "skipped", reason: "Пользователь не найден" };
  try {
    await upsertNotification({
      organizationId,
      userId: msg.userId,
      kind: "mailing",
      dedupeKey: msg.isTest ? `mailing:${msg.campaignId}:test:${msg.recipientId}` : `mailing:${msg.campaignId}`,
      title: msg.title,
      linkHref: msg.url,
      linkLabel: msg.url ? "Открыть" : null,
      items: msg.body ? [{ id: "message", label: msg.body }] : [],
      push: false,
    });
    return { kind: "sent" };
  } catch (error) {
    return { kind: "failed", error: error instanceof Error ? error.message : String(error), transient: true };
  }
}

async function sendPush(msg: OutgoingPush): Promise<SendOutcome> {
  const avail = pushAvailability();
  const [webSubs, appDevices] = await Promise.all([
    db.webPushSubscription.count({ where: { userId: msg.userId } }),
    db.mobileDevice.count({ where: { userId: msg.userId, pushEnabled: true } }),
  ]);
  const reason = pushSkipReason(avail, webSubs, appDevices);
  if (reason) return { kind: "skipped", reason };
  const web = avail.webConfigured ? webSubs : 0;
  const app = avail.appConfigured ? appDevices : 0;
  const tag = `mailing:${msg.campaignId}`;

  if (mailingDryRunDir()) {
    await writeDryRunFile(
      msg.campaignId,
      msg.recipientId,
      "push.json",
      JSON.stringify({ userId: msg.userId, title: msg.title, body: msg.body, url: msg.url, web, app, tag }, null, 2)
    );
    console.info(`[mailing] dry-run push`, { recipient: msg.recipientId, web, app });
    return { kind: "sent", dryRun: true, note: `Сухая отправка: веб-push ${web}, приложение ${app}` };
  }

  let sent = 0;
  const notes: string[] = [];
  if (web > 0) {
    const { sendPushToUser } = await import("@/lib/web-push");
    const r = await sendPushToUser(msg.userId, { title: msg.title, body: msg.body, url: toMiniUrl(msg.url), tag });
    sent += r.sent;
    notes.push(`веб-push: ${r.sent}`);
  }
  if (app > 0) {
    const r = await sendMobilePushToUser(msg.userId, { title: msg.title, body: msg.body, url: msg.url, tag });
    sent += r.sent;
    notes.push(`приложение: ${r.sent}`);
  }
  if (sent > 0) return { kind: "sent", note: notes.join(", ") };
  return { kind: "failed", error: `Push не дошёл ни на одно устройство (${notes.join(", ")})`, transient: true };
}

const PERMANENT_TELEGRAM = /blocked|chat not found|deactivated|kicked|user is deactivated|forbidden|bot can't initiate/i;

async function sendTelegram(msg: OutgoingTelegram): Promise<SendOutcome> {
  const user = await db.user.findUnique({
    where: { id: msg.userId },
    select: { telegramChatId: true, isActive: true },
  });
  if (!user) return { kind: "skipped", reason: "Пользователь не найден" };
  if (!user.telegramChatId) return { kind: "skipped", reason: "Telegram не привязан" };
  if (!user.isActive) return { kind: "skipped", reason: "Пользователь отключён" };
  if (!telegramBotConfigured()) return { kind: "skipped", reason: "Бот Telegram не настроен" };

  if (mailingDryRunDir()) {
    await writeDryRunFile(
      msg.campaignId,
      msg.recipientId,
      "telegram.json",
      JSON.stringify({ userId: msg.userId, chatId: user.telegramChatId, text: msg.text, url: msg.url }, null, 2)
    );
    console.info(`[mailing] dry-run telegram`, { recipient: msg.recipientId });
    return { kind: "sent", dryRun: true, note: "Сухая отправка: сообщение записано в папку, в Telegram не ушло" };
  }

  const dedupeKey = `mailing:${msg.recipientId}`;
  const { sendTelegramMessage } = await import("@/lib/telegram");
  const ok = await sendTelegramMessage(user.telegramChatId, msg.text, {
    userId: msg.userId,
    delivery: { organizationId: msg.organizationId, kind: "mailing", dedupeKey },
  });
  if (ok) return { kind: "sent" };
  const log = await db.telegramLog.findFirst({
    where: { userId: msg.userId, dedupeKey },
    orderBy: { createdAt: "desc" },
    select: { status: true, error: true, deliverAfter: true },
  });
  if (log?.status === "deferred") {
    const when = log.deliverAfter
      ? log.deliverAfter.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" })
      : "конца тихих часов";
    return { kind: "sent", note: `Тихие часы получателя: придёт после ${when}` };
  }
  const error = log?.error ?? "Telegram не принял сообщение";
  return { kind: "failed", error, transient: !PERMANENT_TELEGRAM.test(error) };
}

export function createChannelSenders(): ChannelSenders {
  return {
    email: sendMarketingEmail,
    inApp: sendInApp,
    push: sendPush,
    telegram: sendTelegram,
  };
}
