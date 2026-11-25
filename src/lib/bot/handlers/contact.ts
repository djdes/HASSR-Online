import type { Composer, Context } from "grammy";
import { createTranslator } from "use-intl/core";

import { resolveLocale, type Locale } from "@/i18n/locales";
import { loadMessages, type Messages } from "@/i18n/messages";
import { replyWithLoadedStartHome } from "@/lib/bot/handlers/start";
import { db } from "@/lib/db";
import { escapeHtml } from "@/lib/html-escape";
import {
  buildMiniAppUrl,
  getMiniAppBaseUrlFromEnv,
} from "@/lib/journal-obligation-links";
import { formatPhone, normalizePhone } from "@/lib/phone";
import {
  linkTelegramByVerifiedPhone,
  type LinkTelegramByPhoneResult,
} from "@/lib/telegram-phone-link";
import { buildTelegramWebAppKeyboard } from "@/lib/telegram-web-app";

export type ContactHandlerContext = Pick<Context, "from" | "message" | "reply">;

export type ContactHandlerDeps = {
  localeForChat: (chatId: string) => Promise<Locale>;
  loadMessages: (locale: Locale) => Promise<Messages>;
  linkByPhone: (args: {
    chatId: string;
    rawPhone: string;
  }) => Promise<LinkTelegramByPhoneResult>;
  replyStartHome: (ctx: ContactHandlerContext, chatId: string) => Promise<void>;
  getMiniAppBaseUrl: () => string | null;
};

async function defaultLocaleForChat(chatId: string): Promise<Locale> {
  const user = await db.user.findFirst({
    where: { telegramChatId: chatId, isActive: true, archivedAt: null },
    select: { locale: true, organization: { select: { locale: true } } },
  });
  return resolveLocale({
    authenticated: Boolean(user),
    userLocale: user?.locale,
    organizationLocale: user?.organization.locale,
  });
}

const DEFAULT_DEPS: ContactHandlerDeps = {
  localeForChat: defaultLocaleForChat,
  loadMessages,
  linkByPhone: (args) => linkTelegramByVerifiedPhone(args),
  replyStartHome: (ctx, chatId) =>
    replyWithLoadedStartHome(ctx as Context, chatId),
  getMiniAppBaseUrl: () => getMiniAppBaseUrlFromEnv(),
};

export async function handleTelegramContact(
  ctx: ContactHandlerContext,
  deps: Partial<ContactHandlerDeps> = {}
): Promise<void> {
  const resolvedDeps: ContactHandlerDeps = { ...DEFAULT_DEPS, ...deps };
  const fromId = ctx.from?.id;
  const contact = ctx.message?.contact;
  const locale = fromId ? await resolvedDeps.localeForChat(String(fromId)) : "ru";
  const messages = await resolvedDeps.loadMessages(locale);

  const t = createTranslator({
    locale,
    messages,
    namespace: "telegram.bot.contact",
  });
  const tStart = createTranslator({
    locale,
    messages,
    namespace: "telegram.bot.start",
  });

  if (!fromId || !contact || contact.user_id !== fromId) {
    await ctx.reply(t("notOwnContact"), {
      reply_markup: { remove_keyboard: true },
    });
    return;
  }

  const chatId = String(fromId);
  const result = await resolvedDeps.linkByPhone({
    chatId,
    rawPhone: contact.phone_number,
  });

  if (result.ok) {
    const formattedPhone =
      formatPhone(result.user.phone) || contact.phone_number;
    await ctx.reply(
      t.markup("linkedSuccess", {
        phone: escapeHtml(formattedPhone),
        name: escapeHtml(result.user.name),
        b: (chunks) => `<b>${chunks}</b>`,
      }),
      {
        parse_mode: "HTML",
        reply_markup: { remove_keyboard: true },
      }
    );
    await resolvedDeps.replyStartHome(ctx, chatId);
    return;
  }

  const displayPhone =
    formatPhone(normalizePhone(contact.phone_number)) || contact.phone_number;

  let errorText: string;
  switch (result.status) {
    case "invalid_phone":
      errorText = t("invalidPhone");
      break;
    case "not_found":
      errorText = t("notFound", { phone: displayPhone });
      break;
    case "ambiguous":
      errorText = t("ambiguous", { phone: displayPhone });
      break;
    case "telegram_already_linked_other":
      errorText = t("alreadyLinkedOther");
      break;
    case "user_already_linked_other_tg":
      errorText = t("userHasOtherTelegram", { phone: displayPhone });
      break;
  }

  await ctx.reply(errorText, {
    reply_markup: { remove_keyboard: true },
  });

  if (result.status === "not_found" || result.status === "ambiguous") {
    const baseUrl = resolvedDeps.getMiniAppBaseUrl();
    const loginUrl = baseUrl
      ? buildMiniAppUrl(baseUrl, "/mini/login?linkTg=1") ?? baseUrl
      : null;
    if (loginUrl) {
      const buttonLabel = tStart("openMiniAppButton");
      await ctx.reply(buttonLabel, {
        reply_markup: buildTelegramWebAppKeyboard({
          label: buttonLabel,
          url: loginUrl,
        }),
      });
    }
  }
}

export function registerContactHandler(composer: Composer<Context>): void {
  composer.on("message:contact", async (ctx) => {
    await handleTelegramContact(ctx);
  });
}
