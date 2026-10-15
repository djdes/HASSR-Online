import type { Composer, Context } from "grammy";
import { createTranslator } from "use-intl/core";
import { db } from "@/lib/db";
import { resolveLocale } from "@/i18n/locales";
import { loadMessages } from "@/i18n/messages";

/**
 * Handle `/stop` — unlink the user's Telegram account.
 *
 * Clears `telegramChatId` so the user can re-link later with a fresh invite.
 */
export function registerStopHandler(composer: Composer<Context>): void {
  composer.command("stop", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) {
      const messages = await loadMessages("ru");
      const t = createTranslator({ locale: "ru", messages, namespace: "telegram.bot.stop" });
      await ctx.reply(t("cannotIdentify"));
      return;
    }

    const chatIdStr = String(fromId);
    const user = await db.user.findFirst({
      where: {
        telegramChatId: chatIdStr,
        isActive: true,
        archivedAt: null,
      },
      select: { id: true, name: true, locale: true, organization: { select: { locale: true } } },
    });
    const locale = resolveLocale({
      authenticated: Boolean(user),
      userLocale: user?.locale,
      organizationLocale: user?.organization.locale,
    });
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages, namespace: "telegram.bot.stop" });

    if (!user) {
      await ctx.reply(t("notLinked"));
      return;
    }

    await db.user.update({
      where: { id: user.id },
      data: { telegramChatId: null },
    });

    await ctx.reply(t("unlinked", { name: user.name ?? "—" }));
  });
}
