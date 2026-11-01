import { Composer, type Context } from "grammy";
import { getMiniAppBaseUrlFromEnv } from "@/lib/journal-obligation-links";
import { db } from "@/lib/db";
import { sortJournalsByName } from "@/lib/journal-sort";
import { buildInlineQueryResults } from "@/lib/bot/inline-results";
import { loadManagerPointScope } from "@/lib/worker-point-scope";

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

    // Search equipment — только точек человека и общих цехов (аудит 2026-11-01).
    const scope = await loadManagerPointScope(user.organizationId, user.id);
    const equipment = await db.equipment.findMany({
      where: {
        area: {
          organizationId: user.organizationId,
          ...(scope ? { OR: [{ buildingId: { in: scope.points } }, { buildingId: null }] } : {}),
        },
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

    // is_personal: без него Telegram отдаёт закэшированный ответ любому, кто
    // наберёт тот же запрос, — в том числе людям других организаций и точек.
    await ctx.answerInlineQuery(results, { cache_time: 10, is_personal: true });
  });
}
