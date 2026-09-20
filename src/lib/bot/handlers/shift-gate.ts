import type { Composer, Context } from "grammy";
import { db } from "@/lib/db";
import { botCallbackRateLimiter } from "@/lib/rate-limit";

/**
 * Старая кнопка «Начать смену» в чате бота.
 *
 * «Шлагбаума смены» больше нет: приложение — это кабинет в телефоне
 * (П-3), и отметки начала рабочего дня в нём не было никогда на сайте.
 * Новых сообщений с этой кнопкой бот не шлёт, но в чатах остались
 * старые — их можно нажать в любой момент, и нажатие не должно
 * заканчиваться «ничего не произошло».
 *
 * Поэтому обработчик оставлен: он по-прежнему отмечает выход на смену
 * (это безвредно и полезно руководителю на «Команде») и подсказывает,
 * как открыть кабинет.
 */

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Атомарно создаёт WorkShift статуса scheduled на сегодня.
 * Идемпотентно: если уже есть — обновляет статус.
 */
export async function startShiftForUser(
  userId: string,
  organizationId: string
): Promise<void> {
  const today = utcMidnight(new Date());
  await db.workShift.upsert({
    where: { userId_date: { userId, date: today } },
    create: {
      userId,
      organizationId,
      date: today,
      status: "scheduled",
    },
    update: { status: "scheduled" },
  });
}

export function registerShiftGateHandler(composer: Composer<Context>): void {
  // Callback "shift:start" — юзер нажал «Начать смену».
  composer.callbackQuery("shift:start", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) {
      await ctx.answerCallbackQuery({ text: "Ошибка идентификации" });
      return;
    }
    if (!botCallbackRateLimiter.consume(`${fromId}:shift-start`)) {
      await ctx.answerCallbackQuery({
        text: "Слишком много кликов, подождите минуту",
      });
      return;
    }
    const user = await db.user.findFirst({
      where: { telegramChatId: String(fromId), isActive: true },
      select: { id: true, organizationId: true, name: true },
    });
    if (!user) {
      await ctx.answerCallbackQuery({
        text: "Аккаунт не найден",
        show_alert: true,
      });
      return;
    }
    try {
      await startShiftForUser(user.id, user.organizationId);
    } catch (err) {
      console.error("[shift:start]", err);
      await ctx.answerCallbackQuery({
        text: "Не удалось начать смену",
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Смена отмечена ✓" });
    // Кнопку из старого сообщения убираем: гейта больше нет, и задачи
    // доступны сразу — человеку нужен только вход в кабинет.
    try {
      await ctx.editMessageText(
        `👋 Отметили, ${escapeName(user.name)}!\n\nЗадачи на сегодня уже доступны — нажмите /start, чтобы открыть кабинет.`,
        { parse_mode: "HTML" }
      );
    } catch {
      // ignore — message might already be modified or deleted
    }
  });
}

function escapeName(name: string): string {
  return name
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
