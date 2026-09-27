import { Composer, type Context } from "grammy";
import { getMiniAppBaseUrlFromEnv } from "@/lib/journal-obligation-links";
import { db } from "@/lib/db";
import { sortJournalsByName } from "@/lib/journal-sort";
import { buildInlineQueryResults } from "@/lib/bot/inline-results";

export function registerInlineQueryHandler(composer: Composer<Context>): void {
  composer.on("inline_query", async (ctx) => {
    const query = ctx.inlineQuery.query.trim().toLowerCase();
    const fromId = ctx.from?.id;
    if (!fromId) {
      await ctx.answerInlineQuery([]);
      return;
    }

    // Find linked user
    const user = await db.user.findFirst({
      where: { telegramChatId: String(fromId), isActive: true },
      select: { id: true, organizationId: true },
    });

    if (!user) {
      await ctx.answerInlineQuery([], {
        button: {
          text: "Привязать аккаунт",
          start_parameter: "link",
        },
      });
      return;
    }

    const miniAppBaseUrl = getMiniAppBaseUrlFromEnv();

    // Search journals — первые пять совпадений по алфавиту.
    const journals = sortJournalsByName(
      await db.journalTemplate.findMany({
        where: {
          isActive: true,
          name: { contains: query, mode: "insensitive" },
        },
        select: { code: true, name: true, description: true },
      }),
      (journal) => journal.name
    ).slice(0, 5);

    // Search equipment
    const equipment = await db.equipment.findMany({
      where: {
        area: { organizationId: user.organizationId },
        name: { contains: query, mode: "insensitive" },
      },
      take: 5,
      select: { id: true, name: true, type: true },
    });

    const results = buildInlineQueryResults({
      miniAppBaseUrl,
      journals,
      equipment,
    });

    await ctx.answerInlineQuery(results, { cache_time: 10 });
  });
}
