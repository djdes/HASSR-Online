import type { Composer, Context } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import { getMiniAppBaseUrlFromEnv, buildMiniAppUrl } from "@/lib/journal-obligation-links";
import { buildTelegramWebAppKeyboard } from "@/lib/telegram-web-app";
import { db } from "@/lib/db";
import { resolveLocale } from "@/i18n/locales";
import { loadMessages } from "@/i18n/messages";
import { createTranslator } from "use-intl/core";

/**
 * Короткие команды-ярлыки из меню бота (`/journals`, `/tasks`,
 * `/reports`, `/help`). Каждая отвечает кратким сообщением и
 * web_app-кнопкой, которая открывает нужный раздел Mini App внутри
 * Telegram — пользователь не покидает мессенджер.
 */

async function reply(
  ctx: Context,
  text: string,
  opts: { miniPath: string; buttonLabel: string }
): Promise<void> {
  const base = getMiniAppBaseUrlFromEnv();
  const url = base ? buildMiniAppUrl(base, opts.miniPath) : null;
  await ctx.reply(text, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(url
      ? {
          reply_markup: buildTelegramWebAppKeyboard({
            label: opts.buttonLabel,
            url,
          }),
        }
      : {}),
  });
}

async function shortcutCopy(ctx: Context) {
  const chatId = ctx.from?.id;
  const linked = chatId === undefined ? null : await db.user.findFirst({
    where: { telegramChatId: String(chatId), isActive: true, archivedAt: null },
    select: { locale: true, organization: { select: { locale: true } } },
  });
  const locale = resolveLocale({ authenticated: Boolean(linked), userLocale: linked?.locale, organizationLocale: linked?.organization.locale });
  return { locale, messages: await loadMessages(locale) };
}

export function registerShortcutHandlers(composer: Composer<Context>): void {
  composer.command("journals", async (ctx) => {
    const { locale, messages } = await shortcutCopy(ctx);
    const t = createTranslator({ locale, messages, namespace: "telegramShortcuts.journals" });
    // Даём две дороги: web_app-кнопка на полный список в Mini App
    // (быстрый привычный путь) и inline-кнопка на bot-навигацию
    // `/edit` — drill-down по каждому журналу без выхода из чата.
    const base = getMiniAppBaseUrlFromEnv();
    const url = base ? buildMiniAppUrl(base, "/mini/journals") : null;
    const rows: InlineKeyboardButton[][] = [];
    if (url) {
      rows.push([{ text: t("openInMiniApp"), web_app: { url } }]);
    }
    rows.push([
      { text: t("chooseDocument"), callback_data: "edit:home" },
    ]);
    await ctx.reply(
      `${t("heading")}\n${t("description")}`,
      {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: rows },
      }
    );
  });

  composer.command("tasks", async (ctx) => {
    const { locale, messages } = await shortcutCopy(ctx);
    const t = createTranslator({ locale, messages, namespace: "telegramWorkday.tasks" });
    await reply(
      ctx,
      `${t("title")}\n${t("description")}`,
      { miniPath: "/mini", buttonLabel: t("button") }
    );
  });

  composer.command("reports", async (ctx) => {
    const { locale, messages } = await shortcutCopy(ctx);
    const t = createTranslator({ locale, messages, namespace: "telegramShortcuts.reports" });
    await reply(
      ctx,
      `${t("heading")}\n${t("description")}`,
      { miniPath: "/mini/reports", buttonLabel: t("button") }
    );
  });

  composer.command("help", async (ctx) => {
    const { locale, messages } = await shortcutCopy(ctx);
    const t = createTranslator({ locale, messages, namespace: "telegram.bot.help" });
    await reply(
      ctx,
      t("body"),
      { miniPath: "/mini", buttonLabel: t("button") }
    );
  });
}
