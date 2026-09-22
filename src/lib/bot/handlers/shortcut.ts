import type { Composer, Context } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import { getMiniAppBaseUrlFromEnv, buildMiniAppUrl } from "@/lib/journal-obligation-links";
import { buildTelegramWebAppKeyboard } from "@/lib/telegram-web-app";

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

export function registerShortcutHandlers(composer: Composer<Context>): void {
  composer.command("journals", async (ctx) => {
    // Даём две дороги: web_app-кнопка на полный список в Mini App
    // (быстрый привычный путь) и inline-кнопка на bot-навигацию
    // `/edit` — drill-down по каждому журналу без выхода из чата.
    const base = getMiniAppBaseUrlFromEnv();
    const url = base ? buildMiniAppUrl(base, "/mini/journals") : null;
    const rows: InlineKeyboardButton[][] = [];
    if (url) {
      rows.push([{ text: "📋 Открыть в Mini App", web_app: { url } }]);
    }
    rows.push([
      { text: "✏️ Выбрать и изменить документ", callback_data: "edit:home" },
    ]);
    await ctx.reply(
      "📋 <b>Мои журналы</b>\nВсе журналы СанПиН и ХАССП прямо в Telegram — клик по ячейке, запись готова.",
      {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: rows },
      }
    );
  });

  composer.command("tasks", async (ctx) => {
    await reply(
      ctx,
      "✅ <b>Задачи на сегодня</b>\nТо, что надо заполнить прямо сейчас: гигиена, температуры, уборка, бракераж.",
      { miniPath: "/mini", buttonLabel: "Задачи на смену" }
    );
  });

  composer.command("reports", async (ctx) => {
    await reply(
      ctx,
      "📊 <b>Отчёты</b>\nPDF и Excel за любой период. Одна кнопка «По звонку инспектора» собирает ZIP с cover-страницей, всеми журналами и CAPA за последние 7 дней.",
      { miniPath: "/mini/reports", buttonLabel: "Открыть отчёты" }
    );
  });

  composer.command("help", async (ctx) => {
    await reply(
      ctx,
      "💬 <b>WeSetup в Telegram</b>\n\n" +
        "<b>Сотруднику</b>\n" +
        "• /start — домашний экран\n" +
        "• /shift — моя смена · открыть/закрыть в один тап\n" +
        "• /tasks — что надо заполнить сегодня\n" +
        "• /my_digest — те же задачи, но списком в чате\n" +
        "• /journals — журналы СанПиН и ХАССП\n" +
        "• /me — мой профиль\n\n" +
        "<b>Руководителю</b>\n" +
        "• /today — сводка за сегодня (X / Y журналов)\n" +
        "• /missing — что не заполнено (с именами)\n" +
        "• /staff — кто на смене сегодня\n" +
        "• /capa — открытые CAPA-тикеты\n" +
        "• /batches — активные партии\n" +
        "• /losses — списания за неделю\n" +
        "• /stats — недельный график выполнения\n" +
        "• /who_late — кто на смене > 2ч без записей в журналах\n" +
        "• /health — диагностика бота (build sha, DB, Telegram API)\n" +
        "• /reports — PDF и ZIP для инспектора\n\n" +
        "<b>Прочее</b>\n" +
        "• Любой текст — вопрос в поддержку: напишите его прямо сюда, ответ придёт в этот чат\n" +
        "• /stop — отвязать Telegram\n\n" +
        "Поддержка: пишите в @wesetupbot — отвечаем лично.\n" +
        "Сайт: wesetup.ru",
      { miniPath: "/mini", buttonLabel: "Открыть Кабинет" }
    );
  });
}
