import type { Composer, Context } from "grammy";
import { db } from "@/lib/db";
import { sendFeedbackAdminEmail } from "@/lib/email";
import {
  applyFeedbackReply,
  describeFeedbackReplyChannels,
} from "@/lib/feedback-reply";
import {
  isPlatformAdminChat as isAdminChat,
  notifyPlatformAdmin,
  sendToPlatformAdminEmails,
} from "@/lib/platform-admin";
import { botSupportRateLimiter } from "@/lib/rate-limit";
import { extractSupportThreadId } from "@/lib/support-chat";
import { escapeTelegramHtml } from "@/lib/telegram";

/**
 * Входящая поддержка в боте.
 *
 * До этого обработчика у бота не было ни одного `on("message:text")`:
 * человек писал вопрос в личку @wesetupbot — и сообщение просто исчезало,
 * хотя форма обратной связи на сайте прямо обещает «оперативную помощь в
 * Telegram». Теперь любой текст = обращение: строка в FeedbackReport,
 * пересылка админу платформы и подтверждение автору.
 *
 * Регистрируется ПОСЛЕДНИМ из message-обработчиков (см. bot-app.ts):
 * `composer.command()` матчит только команды, поэтому catch-all
 * `on("message:text")` не перехватывает /start и остальные.
 */

const APP_URL = process.env.NEXTAUTH_URL || "https://wesetup.ru";

/** Машиночитаемый якорь в админ-сообщении: по нему находим обращение при ответе реплаем. */
const FEEDBACK_TAG_PATTERN = /#fb_([A-Za-z0-9_-]+)/;

export function buildFeedbackTag(reportId: string): string {
  return `#fb_${reportId}`;
}

/** Достаёт id обращения из текста сообщения, на которое ответили реплаем. */
export function extractFeedbackReportId(
  text: string | null | undefined
): string | null {
  if (!text) return null;
  const match = text.match(FEEDBACK_TAG_PATTERN);
  return match ? match[1] : null;
}

/** «Иван Иванов · ivan@x.ru» / «@nickname» / «не привязан к аккаунту». */
export function describeSupportSender(args: {
  userName?: string | null;
  userEmail?: string | null;
  telegramUsername?: string | null;
  linked: boolean;
}): string {
  const parts = [args.userName, args.userEmail].filter(Boolean) as string[];
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  if (args.telegramUsername) {
    return `@${args.telegramUsername} · не привязан к аккаунту`;
  }
  return args.linked ? "аккаунт без имени" : "не привязан к аккаунту";
}

/** Имя из Telegram-профиля, когда аккаунта в WeSetup нет. */
export function telegramDisplayName(args: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}): string | null {
  const full = [args.firstName, args.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  if (full) return full;
  return args.username ? `@${args.username}` : null;
}

export function buildSupportAdminMessage(args: {
  reportId: string;
  message: string;
  sender: string;
  organizationName?: string | null;
}): string {
  const lines = [
    "💬 <b>Сообщение боту</b>",
    "",
    escapeTelegramHtml(args.message),
    "",
    `👤 ${escapeTelegramHtml(args.sender)}`,
  ];
  if (args.organizationName) {
    lines.push(`🏢 ${escapeTelegramHtml(args.organizationName)}`);
  }
  lines.push(
    "",
    buildFeedbackTag(args.reportId),
    "Ответить: свайп-reply на это сообщение — ответ уйдёт человеку в Telegram.",
    `<a href="${APP_URL}/root/feedback">Или из панели обращений</a>`
  );
  return lines.join("\n");
}

/** Снимок входящего сообщения — то немногое, что нужно логике из grammy-ctx. */
export type SupportMessageInput = {
  chatType: string | undefined;
  chatId: string | null;
  fromId: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  text: string;
  /** Текст сообщения, на которое ответили реплаем (для ветки админа). */
  replyToText?: string | null;
};

export type SupportOutcome = {
  action:
    | "ignored"
    | "rate-limited"
    | "unknown-command"
    | "admin-reply"
    | "admin-chat-reply"
    | "admin-reply-no-tag"
    | "created"
    | "error";
  /** Что ответить в чат. null — молча выйти. */
  reply: string | null;
  reportId?: string;
  threadId?: string;
};

type SupportUser = {
  id: string;
  name: string | null;
  email: string | null;
  organizationId: string | null;
  organizationName: string | null;
};

export type SupportDeps = {
  isPlatformAdminChat: (chatId: string) => boolean | Promise<boolean>;
  allowMessage: (key: string) => boolean;
  findUserByChatId: (chatId: string) => Promise<SupportUser | null>;
  createReport: (args: {
    telegramChatId: string;
    message: string;
    userId: string | null;
    userEmail: string | null;
    userName: string | null;
    organizationId: string | null;
    organizationName: string | null;
  }) => Promise<{ id: string; createdAt: Date }>;
  notifyAdminTelegram: (text: string) => Promise<boolean>;
  emailAdmin: (args: {
    message: string;
    userName: string | null;
    userEmail: string | null;
    organizationName: string | null;
    submittedAt: Date;
  }) => Promise<boolean>;
  markAdminNotified: (args: {
    reportId: string;
    telegram: boolean;
    email: boolean;
  }) => Promise<void>;
  replyToReport: (args: {
    reportId: string;
    message: string;
  }) => Promise<string[]>;
  /** Ответ в онлайн-чат: дописывает реплику оператора в ветку переписки. */
  replyToChat: (args: {
    threadId: string;
    message: string;
    operatorName: string;
  }) => Promise<void>;
};

function defaultDeps(): SupportDeps {
  return {
    isPlatformAdminChat(chatId) {
      // env-чаты и администраторы платформы с привязанным Telegram.
      return isAdminChat(chatId);
    },
    allowMessage(key) {
      return botSupportRateLimiter.consume(key);
    },
    async findUserByChatId(chatId) {
      const user = await db.user.findFirst({
        where: { telegramChatId: chatId, isActive: true, archivedAt: null },
        select: {
          id: true,
          name: true,
          email: true,
          organizationId: true,
          organization: { select: { name: true } },
        },
      });
      if (!user) return null;
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        organizationId: user.organizationId,
        organizationName: user.organization?.name ?? null,
      };
    },
    async createReport(args) {
      const report = await db.feedbackReport.create({
        data: {
          type: "support",
          source: "telegram",
          telegramChatId: args.telegramChatId,
          message: args.message,
          userId: args.userId,
          userEmail: args.userEmail,
          userName: args.userName,
          organizationId: args.organizationId,
          organizationName: args.organizationName,
        },
        select: { id: true, createdAt: true },
      });
      return report;
    },
    async notifyAdminTelegram(text) {
      // Своё подробное письмо — emailAdmin.
      return notifyPlatformAdmin(text, { kind: "support", email: false });
    },
    async emailAdmin({
      message,
      userName,
      userEmail,
      organizationName,
      submittedAt,
    }) {
      return sendToPlatformAdminEmails((to) =>
        sendFeedbackAdminEmail({
          to,
          type: "support",
          message,
          userName,
          userEmail,
          organizationName,
          submittedAt,
        })
      );
    },
    async markAdminNotified({ reportId, telegram, email }) {
      await db.feedbackReport.update({
        where: { id: reportId },
        data: {
          adminTgNotifiedAt: telegram ? new Date() : null,
          adminEmailedAt: email ? new Date() : null,
        },
      });
    },
    async replyToChat({ threadId, message, operatorName }) {
      // Реплика в старую личную ветку уходит в ветку организации; счётчики
      // непрочитанного и уведомление клиенту — в общей библиотеке чата.
      const { deliverOperatorMessage, postOperatorMessage, resolveReplyTarget } =
        await import("@/lib/support-threads");
      const target = await resolveReplyTarget(threadId);
      const operator = {
        kind: "admin" as const,
        name: operatorName,
        userId: null,
        partnerId: null,
      };
      const posted = await postOperatorMessage({
        threadId: target.thread.id,
        body: message,
        attachments: [],
        operator,
      });
      // Доставка не должна ронять свайп-реплай: реплика уже сохранена.
      await deliverOperatorMessage({ ...posted, operator }).catch((error) =>
        console.error("[bot:support] client delivery failed:", error)
      );
    },
    async replyToReport({ reportId, message }) {
      const result = await applyFeedbackReply({
        reportId,
        message,
        respondedById: "telegram-admin",
        respondedByName: "Поддержка WeSetup",
      });
      return describeFeedbackReplyChannels(result.channels);
    },
  };
}

/**
 * Чистая логика обработки текста в личке бота — без grammy, чтобы её
 * можно было прогонять в тестах на подставных зависимостях.
 */
export async function handleSupportText(
  input: SupportMessageInput,
  overrides?: Partial<SupportDeps>
): Promise<SupportOutcome> {
  const deps = { ...defaultDeps(), ...overrides };

  // Группы не трогаем: там живут организационные уведомления, и любой
  // рабочий трёп превратился бы в поток обращений.
  if (input.chatType !== "private" || !input.chatId || !input.fromId) {
    return { action: "ignored", reply: null };
  }

  const text = input.text.trim();
  if (!text) {
    return { action: "ignored", reply: null };
  }

  // Владелец отвечает свайп-реплаем прямо из своего чата с ботом.
  if (input.replyToText && (await deps.isPlatformAdminChat(input.chatId))) {
    // Онлайн-чат проверяем первым: у него свой тег, и реплика должна
    // попасть в переписку, а не завестись отдельным обращением.
    const threadId = extractSupportThreadId(input.replyToText);
    if (threadId) {
      try {
        await deps.replyToChat({
          threadId,
          message: text,
          operatorName: "Поддержка WeSetup",
        });
        return {
          action: "admin-chat-reply",
          threadId,
          reply: "✓ Отправлено в онлайн-чат",
        };
      } catch {
        return {
          action: "error",
          reply: "⚠ Не удалось дописать ответ в чат — откройте админку",
        };
      }
    }

    const reportId = extractFeedbackReportId(input.replyToText);
    if (!reportId) {
      return {
        action: "admin-reply-no-tag",
        reply:
          "Не нашёл обращение: отвечайте реплаем на сообщение с тегом #fb_… или #chat_…",
      };
    }
    try {
      const channels = await deps.replyToReport({ reportId, message: text });
      return {
        action: "admin-reply",
        reportId,
        reply:
          channels.length > 0
            ? `✓ Отправлено (${channels.join(" · ")})`
            : "⚠ Не доставлено ни по одному каналу — откройте панель обращений",
      };
    } catch (error) {
      console.error("[bot:support] admin reply failed", error);
      return {
        action: "error",
        reply: "Не получилось отправить ответ — попробуйте из панели обращений",
      };
    }
  }

  // Неизвестная команда: подсказываем /help и приглашаем написать текстом.
  if (text.startsWith("/")) {
    return {
      action: "unknown-command",
      reply:
        "Не знаю такую команду — посмотрите /help. А если это вопрос, напишите его обычным текстом, мы ответим.",
    };
  }

  // Флуд отбрасываем молча: отвечать на каждое сообщение спамера — тот же спам.
  if (!deps.allowMessage(`support:${input.fromId}`)) {
    return { action: "rate-limited", reply: null };
  }

  try {
    const user = await deps.findUserByChatId(input.fromId);
    const fallbackName = telegramDisplayName({
      firstName: input.firstName,
      lastName: input.lastName,
      username: input.username,
    });

    const report = await deps.createReport({
      telegramChatId: input.chatId,
      message: text,
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
      userName: user?.name ?? fallbackName,
      organizationId: user?.organizationId ?? null,
      organizationName: user?.organizationName ?? null,
    });

    const sender = describeSupportSender({
      userName: user?.name ?? fallbackName,
      userEmail: user?.email ?? null,
      telegramUsername: input.username ?? null,
      linked: Boolean(user),
    });

    const [telegram, email] = await Promise.all([
      deps
        .notifyAdminTelegram(
          buildSupportAdminMessage({
            reportId: report.id,
            message: text,
            sender,
            organizationName: user?.organizationName ?? null,
          })
        )
        .catch((error) => {
          console.error("[bot:support] admin telegram failed", error);
          return false;
        }),
      deps
        .emailAdmin({
          message: text,
          userName: user?.name ?? fallbackName,
          userEmail: user?.email ?? null,
          organizationName: user?.organizationName ?? null,
          submittedAt: report.createdAt,
        })
        .catch((error) => {
          console.error("[bot:support] admin email failed", error);
          return false;
        }),
    ]);

    await deps
      .markAdminNotified({ reportId: report.id, telegram, email })
      .catch((error) => {
        console.error("[bot:support] delivery status update failed", error);
      });

    return {
      action: "created",
      reportId: report.id,
      reply:
        "Сообщение передано в поддержку WeSetup. Ответ придёт сюда же, обычно в течение рабочего дня.",
    };
  } catch (error) {
    console.error("[bot:support]", error);
    return {
      action: "error",
      reply: "Не получилось передать сообщение, попробуйте ещё раз позже",
    };
  }
}

export function registerSupportHandlers(composer: Composer<Context>): void {
  composer.on("message:text", async (ctx) => {
    const outcome = await handleSupportText({
      chatType: ctx.chat?.type,
      chatId: ctx.chat?.id != null ? String(ctx.chat.id) : null,
      fromId: ctx.from?.id != null ? String(ctx.from.id) : null,
      firstName: ctx.from?.first_name ?? null,
      lastName: ctx.from?.last_name ?? null,
      username: ctx.from?.username ?? null,
      text: ctx.message.text ?? "",
      replyToText:
        ctx.message.reply_to_message?.text ??
        ctx.message.reply_to_message?.caption ??
        null,
    });

    if (!outcome.reply) return;
    try {
      await ctx.reply(outcome.reply, {
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      console.error("[bot:support] reply failed", error);
    }
  });

  // Медиа пока не принимаем: пересылка фото админу — отдельная задача,
  // а молча проглатывать вложение хуже, чем честно попросить текст.
  composer.on(
    ["message:photo", "message:document", "message:voice", "message:video"],
    async (ctx) => {
      if (ctx.chat?.type !== "private") return;
      try {
        await ctx.reply(
          "Фото и файлы пока не принимаем — опишите вопрос текстом, и он попадёт в поддержку."
        );
      } catch (error) {
        console.error("[bot:support] media reply failed", error);
      }
    }
  );
}
