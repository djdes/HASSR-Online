/**
 * Доставка ответа на обращение.
 *
 * Раньше ответ из ROOT-панели создавал только in-app уведомление
 * (колокольчик в шапке сайта): человек, который написал с телефона или
 * вообще из Telegram-бота, ответа не видел никогда. Здесь ответ уходит
 * по всем каналам, которые есть у автора обращения, а вызывающий код
 * получает честный список фактически сработавших.
 *
 * Каналы независимы: упавшая почта не должна отменять доставку в
 * Telegram, поэтому каждый обёрнут в свой try/catch.
 */

import { db } from "@/lib/db";
import { sendFeedbackReplyEmail } from "@/lib/email";
import { resolveLocale } from "@/i18n/locales";
import { upsertNotification } from "@/lib/notifications";
import { escapeTelegramHtml, sendTelegramMessage } from "@/lib/telegram";

export type FeedbackReplyChannels = {
  inApp: boolean;
  telegram: boolean;
  email: boolean;
};

type FeedbackReplyReport = {
  id: string;
  userId: string | null;
  userEmail: string | null;
  organizationId: string | null;
  telegramChatId: string | null;
  message: string;
};

type FeedbackReplyRecipient = {
  id: string;
  telegramChatId: string | null;
  locale?: string | null;
  organizationLocale?: string | null;
};

export type FeedbackReplyDeps = {
  findReport: (reportId: string) => Promise<FeedbackReplyReport | null>;
  saveReply: (args: {
    reportId: string;
    responseMessage: string;
    respondedAt: Date;
    respondedById: string;
    respondedByName: string;
  }) => Promise<void>;
  findRecipient: (args: {
    userId: string;
    organizationId: string | null;
  }) => Promise<FeedbackReplyRecipient | null>;
  pushInAppNotification: (args: {
    organizationId: string;
    userId: string;
    reportId: string;
    responseMessage: string;
  }) => Promise<void>;
  sendTelegram: (chatId: string, text: string) => Promise<boolean>;
  sendEmail: (args: {
    to: string;
    replyMessage: string;
    originalMessage: string;
    respondedByName: string;
    locale?: "ru" | "en" | "uz";
  }) => Promise<boolean>;
};

export class FeedbackReplyError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FeedbackReplyError";
    this.status = status;
  }
}

function defaultDeps(): FeedbackReplyDeps {
  return {
    async findReport(reportId) {
      return db.feedbackReport.findUnique({
        where: { id: reportId },
        select: {
          id: true,
          userId: true,
          userEmail: true,
          organizationId: true,
          telegramChatId: true,
          message: true,
        },
      });
    },
    async saveReply({
      reportId,
      responseMessage,
      respondedAt,
      respondedById,
      respondedByName,
    }) {
      await db.feedbackReport.update({
        where: { id: reportId },
        data: {
          responseMessage,
          respondedAt,
          respondedById,
          respondedByName,
        },
      });
    },
    async findRecipient({ userId, organizationId }) {
      return db.user.findFirst({
        where: {
          id: userId,
          ...(organizationId ? { organizationId } : {}),
          isActive: true,
          archivedAt: null,
        },
        select: { id: true, telegramChatId: true, locale: true, organization: { select: { locale: true } } },
      }).then((user) => user ? {
        id: user.id,
        telegramChatId: user.telegramChatId,
        locale: user.locale,
        organizationLocale: user.organization.locale,
      } : null);
    },
    async pushInAppNotification({
      organizationId,
      userId,
      reportId,
      responseMessage,
    }) {
      await upsertNotification({
        organizationId,
        userId,
        kind: "feedback.reply",
        dedupeKey: `feedback.reply:${reportId}`,
        title: "Получен ответ на ваше обращение",
        messageKey: "feedbackReply",
        items: [{ id: reportId, label: responseMessage }],
      });
    },
    async sendTelegram(chatId, text) {
      return sendTelegramMessage(chatId, text, {
        delivery: { kind: "feedback:reply" },
      });
    },
    async sendEmail({ to, replyMessage, originalMessage, respondedByName, locale }) {
      return sendFeedbackReplyEmail({
        to,
        replyMessage,
        originalMessage,
        respondedByName,
        locale,
      });
    },
  };
}

/** Короткая цитата исходного обращения — чтобы человек вспомнил контекст. */
export function quoteOriginalMessage(message: string, limit = 100): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

/** Тело Telegram-ответа. Вынесено отдельно, чтобы тестировать без сети. */
export function buildFeedbackReplyTelegramText(args: {
  replyMessage: string;
  originalMessage: string;
}): string {
  return [
    "📮 <b>Ответ поддержки WeSetup</b>",
    "",
    escapeTelegramHtml(args.replyMessage),
    "",
    `<i>На ваше сообщение: «${escapeTelegramHtml(quoteOriginalMessage(args.originalMessage))}»</i>`,
  ].join("\n");
}

export async function applyFeedbackReply(
  args: {
    reportId: string;
    message: string;
    respondedById: string;
    respondedByName: string;
  },
  overrides?: Partial<FeedbackReplyDeps>
): Promise<{
  channels: FeedbackReplyChannels;
  respondedAt: Date;
  responseMessage: string;
  respondedByName: string;
}> {
  const deps = { ...defaultDeps(), ...overrides };

  const report = await deps.findReport(args.reportId);
  if (!report) {
    throw new FeedbackReplyError("Обращение не найдено", 404);
  }

  const responseMessage = args.message.trim();
  if (!responseMessage) {
    throw new FeedbackReplyError("Введите текст ответа", 400);
  }

  const respondedAt = new Date();
  await deps.saveReply({
    reportId: report.id,
    responseMessage,
    respondedAt,
    respondedById: args.respondedById,
    respondedByName: args.respondedByName,
  });

  const channels: FeedbackReplyChannels = {
    inApp: false,
    telegram: false,
    email: false,
  };

  // Автор мог быть удалён/архивирован — тогда ни колокольчика, ни его
  // личного Telegram нет, но письмо и chat id из бота всё ещё работают.
  let recipient: FeedbackReplyRecipient | null = null;
  if (report.userId) {
    try {
      recipient = await deps.findRecipient({
        userId: report.userId,
        organizationId: report.organizationId,
      });
    } catch (error) {
      console.error("[feedback-reply] recipient lookup failed:", error);
    }
  }

  if (recipient && report.organizationId) {
    try {
      await deps.pushInAppNotification({
        organizationId: report.organizationId,
        userId: recipient.id,
        reportId: report.id,
        responseMessage,
      });
      channels.inApp = true;
    } catch (error) {
      console.error("[feedback-reply] in-app notification failed:", error);
    }
  }

  // Обращение из бота отвечаем в тот же чат; обращение с сайта — в личный
  // Telegram автора, если он привязан.
  const chatId = report.telegramChatId ?? recipient?.telegramChatId ?? null;
  if (chatId) {
    try {
      channels.telegram = await deps.sendTelegram(
        chatId,
        buildFeedbackReplyTelegramText({
          replyMessage: responseMessage,
          originalMessage: report.message,
        })
      );
    } catch (error) {
      console.error("[feedback-reply] telegram failed:", error);
    }
  }

  if (report.userEmail) {
    try {
      channels.email = await deps.sendEmail({
        to: report.userEmail,
        replyMessage: responseMessage,
        originalMessage: report.message,
        respondedByName: args.respondedByName,
        locale: resolveLocale({ authenticated: true, userLocale: recipient?.locale, organizationLocale: recipient?.organizationLocale }),
      });
    } catch (error) {
      console.error("[feedback-reply] email failed:", error);
    }
  }

  return {
    channels,
    respondedAt,
    responseMessage,
    respondedByName: args.respondedByName,
  };
}

/** «в приложении · Telegram · почта» — для toast'а и подтверждения в боте. */
export function describeFeedbackReplyChannels(
  channels: FeedbackReplyChannels
): string[] {
  const labels: string[] = [];
  if (channels.inApp) labels.push("в приложении");
  if (channels.telegram) labels.push("Telegram");
  if (channels.email) labels.push("почта");
  return labels;
}
