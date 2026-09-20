import type { Composer, Context } from "grammy";
import {
  hashBotInviteToken,
  stripBotInvitePrefix,
} from "@/lib/bot-invite-tokens";
import { loadTelegramStartHome } from "@/lib/bot/start-home";
import {
  buildTelegramLinkedStartReply,
  buildTelegramUnlinkedStartReply,
  type TelegramLinkedStartState,
} from "@/lib/bot/start-response";
import { db } from "@/lib/db";
import { telegramConsultantFooter } from "@/lib/partners/branding";
import { parseLinkToken } from "@/lib/telegram";
import { getMiniAppBaseUrlFromEnv } from "@/lib/journal-obligation-links";
import { buildTelegramWebAppKeyboard } from "@/lib/telegram-web-app";

function getMiniAppBaseUrl(): string | null {
  return getMiniAppBaseUrlFromEnv();
}

async function replyWithLinkedStart(
  ctx: Context,
  state: TelegramLinkedStartState,
  buttonUrl: string | null,
  consultantFooter = ""
): Promise<void> {
  const reply = buildTelegramLinkedStartReply(state, buttonUrl, consultantFooter);
  await ctx.reply(reply.text, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(reply.buttonLabel && reply.buttonUrl
      ? {
          reply_markup: buildTelegramWebAppKeyboard({
            label: reply.buttonLabel,
            url: reply.buttonUrl,
          }),
        }
      : {}),
  });
}

async function replyWithLoadedStartHome(
  ctx: Context,
  fromId: string
): Promise<void> {
  const home = await loadTelegramStartHome({
    chatId: fromId,
    miniAppBaseUrl: getMiniAppBaseUrl(),
  });

  if (home.kind === "unlinked") {
    await ctx.reply(buildTelegramUnlinkedStartReply().text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    return;
  }

  // Раньше здесь стоял «шлагбаум смены»: линейному сотруднику вместо
  // задач выдавалась одна кнопка «Начать смену». Отметки начала смены
  // в приложении больше нет — смены ставит руководитель в графике
  // кабинета, — поэтому бот сразу отдаёт задачи всем одинаково.
  const dbUser = await db.user.findFirst({
    where: { telegramChatId: fromId, isActive: true },
    select: { organizationId: true },
  });
  // White-label: клиенты партнёра видят в приветствии «Ваш консультант».
  const consultantFooter = await telegramConsultantFooter(dbUser?.organizationId);

  if (home.kind === "manager") {
    await replyWithLinkedStart(
      ctx,
      {
        name: home.actor.name,
        role: home.actor.role,
        isRoot: home.actor.isRoot,
        kind: "manager",
        pendingCount: home.summary.pending,
        employeesWithPending: home.summary.employeesWithPending,
      },
      home.buttonUrl,
      consultantFooter
    );
    return;
  }

  if (home.kind === "readonly") {
    await replyWithLinkedStart(
      ctx,
      {
        name: home.actor.name,
        role: home.actor.role,
        isRoot: home.actor.isRoot,
        kind: "readonly",
      },
      home.buttonUrl,
      consultantFooter
    );
    return;
  }

  await replyWithLinkedStart(
    ctx,
    {
      name: home.actor.name,
      role: home.actor.role,
      isRoot: home.actor.isRoot,
      kind: "staff",
      nextActionLabel: home.nextAction?.label ?? null,
    },
    home.buttonUrl,
    consultantFooter
  );
}

/**
 * Handle `/start <payload>` messages.
 *
 * The only payload shape Stage 1 recognises is `inv_<raw>`: a TG-first
 * invite. When a match is found we bind the caller's TG user id to the
 * pending `User`, flip `isActive`, mark the token consumed, then reply
 * with a Mini App Web App button.
 *
 * Every branch that results in a DM reply MUST use plain text (no HTML /
 * Markdown) to avoid accidental entity escaping issues. The bot never
 * echoes the raw token back.
 */

/**
 * Привязка собственного аккаунта по ссылке из настроек.
 *
 * Возвращает true, если payload оказался токеном привязки и ответ уже
 * отправлен. false — payload чужой, пусть решает вызывающий.
 */
async function handleSelfLinkToken(
  ctx: Context,
  payload: string,
  chatId: string
): Promise<boolean> {
  const parsed = parseLinkToken(payload);
  if (!parsed) return false;

  const user = await db.user.findUnique({
    where: { id: parsed.userId },
    select: { id: true, name: true },
  });
  if (!user) {
    await ctx.reply(
      "Аккаунт не найден. Сгенерируйте новую ссылку в «Настройки → Уведомления»."
    );
    return true;
  }

  // Один Telegram — один сотрудник: иначе поиск по telegramChatId начнёт
  // отдавать чужую учётную запись, и Mini App откроется не тому.
  const collision = await db.user.findFirst({
    where: { telegramChatId: chatId, id: { not: user.id } },
    select: { id: true },
  });
  if (collision) {
    await ctx.reply(
      "Этот Telegram уже привязан к другому сотруднику. Отвяжите его командой /stop в том аккаунте или используйте другой Telegram."
    );
    return true;
  }

  await db.user.update({
    where: { id: user.id },
    data: { telegramChatId: chatId },
  });

  await replyWithLoadedStartHome(ctx, chatId);
  return true;
}

export function registerStartHandler(composer: Composer<Context>): void {
  composer.command("start", async (ctx) => {
    const payload = ctx.match?.trim();
    if (!payload) {
      const fromId = ctx.from?.id;
      if (!fromId) {
        await ctx.reply("Не удалось определить ваш Telegram-аккаунт.");
        return;
      }

      await replyWithLoadedStartHome(ctx, String(fromId));
      return;
    }

    const fromId = ctx.from?.id;
    if (!fromId) {
      await ctx.reply("Не удалось определить ваш Telegram-аккаунт.");
      return;
    }

    if (!stripBotInvitePrefix(payload)) {
      // Второй тип payload — HMAC-токен привязки СВОЕГО аккаунта из
      // «Настройки → Уведомления». Раньше обработчик знал только про
      // приглашения `inv_`, и человек, привязывающий собственный
      // Telegram, получал «Ссылка-приглашение некорректна. Попросите
      // руководителя создать новую» — совет, который ему не помогал:
      // ссылку он сгенерировал сам и она была верной.
      const handled = await handleSelfLinkToken(ctx, payload, String(fromId));
      if (handled) return;

      await ctx.reply(
        "Ссылка не распознана. Откройте «Настройки → Уведомления» в кабинете и нажмите «Привязать Telegram», либо попросите руководителя прислать приглашение."
      );
      return;
    }

    const tokenHash = hashBotInviteToken(payload);

    const token = await db.botInviteToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!token) {
      await ctx.reply(
        "Приглашение не найдено или уже использовано. Попросите новую ссылку."
      );
      return;
    }
    if (token.consumedAt) {
      await ctx.reply("Это приглашение уже использовано.");
      return;
    }
    if (token.expiresAt.getTime() < Date.now()) {
      await ctx.reply("Срок действия приглашения истек. Попросите новую ссылку.");
      return;
    }

    const chatIdStr = String(fromId);

    // Forbid reusing a TG account that's already tied to a different user:
    // otherwise two physical employees could share one Telegram, and our
    // `User.telegramChatId` lookup would silently route Mini App sessions
    // to whichever row is found first.
    const collision = await db.user.findFirst({
      where: {
        telegramChatId: chatIdStr,
        id: { not: token.userId },
      },
      select: { id: true },
    });
    if (collision) {
      await ctx.reply(
        "Этот Telegram уже привязан к другому сотруднику. Используйте другой аккаунт."
      );
      return;
    }

    await db.$transaction([
      db.user.update({
        where: { id: token.userId },
        data: {
          telegramChatId: chatIdStr,
          isActive: true,
        },
      }),
      db.botInviteToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      }),
    ]);

    await replyWithLoadedStartHome(ctx, chatIdStr);
  });
}
