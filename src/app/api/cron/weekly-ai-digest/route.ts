import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueueAndWait } from "@/lib/ai-assistant/pf-client";
import { checkCronSecret } from "@/lib/cron-auth";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { notifyOrganization } from "@/lib/telegram";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/weekly-ai-digest?secret=$CRON_SECRET
 *
 * Раз в неделю (например, понедельник 08:00 MSK) для каждой org
 * с активной подпиской (AI — через диспетчер ProjectsFlow):
 *   1. Собираем factual digest за прошлую неделю (compliance %,
 *      число CAPA, число потерь, число записей, ТОП проблемных
 *      журналов).
 *   2. Отдаём диспетчеру ProjectsFlow → короткий нарратив
 *      «Вот что было хорошо / плохо / на следующей неделе».
 *   3. Отправляем management через Telegram.
 *
 * НЕ заменяет существующий weekly-digest cron (который шлёт
 * структурированные числа). Этот добавляет AI-narrative поверх.
 *
 * Если интеграция с диспетчером не настроена — silent skip (не
 * падает, просто нечего слать).
 *
 * INFRA NEXT: cron понедельник 08:00 MSK = 05:00 UTC.
 */

const SYSTEM_PROMPT = `Ты — AI-аналитик в WeSetup. Твоя задача — на основе compliance-статистики ресторана за прошедшую неделю написать короткое сообщение руководству в Telegram. Его читают между делами: первая строка — оценка недели, дальше только то, что требует внимания или решения.

Структура:
1. Краткая оценка недели (1 предложение)
2. Что хорошо — 1-2 факта с цифрами
3. Что плохо или требует внимания — 1-2 факта
4. Рекомендация на следующую неделю — 1 действие

Стиль:
- Все числа с цифрами и единицами
- Без markdown-форматирования (Telegram HTML allowed: <b>, <i>)
- На русском

Если всё нормально — пиши кратко («Стабильная неделя, продолжайте в том же духе»). Не выдумывай проблем.`;

async function buildContext(orgId: string, weekStart: Date, weekEnd: Date) {
  const [
    capaOpened,
    capaClosed,
    lossSum,
    fieldEntries,
    docEntries,
    overrideCount,
  ] = await Promise.all([
    db.capaTicket.count({
      where: {
        organizationId: orgId,
        createdAt: { gte: weekStart, lt: weekEnd },
      },
    }),
    db.capaTicket.count({
      where: {
        organizationId: orgId,
        status: "closed",
        closedAt: { gte: weekStart, lt: weekEnd },
      },
    }),
    db.lossRecord.aggregate({
      where: {
        organizationId: orgId,
        date: { gte: weekStart, lt: weekEnd },
      },
      _sum: { costRub: true },
      _count: { id: true },
    }),
    db.journalEntry.count({
      where: {
        organizationId: orgId,
        createdAt: { gte: weekStart, lt: weekEnd },
      },
    }),
    db.journalDocumentEntry.count({
      where: {
        document: { organizationId: orgId },
        createdAt: { gte: weekStart, lt: weekEnd },
        ...NOT_AUTO_SEEDED,
      },
    }),
    db.auditLog.count({
      where: {
        organizationId: orgId,
        action: "closed_day.override",
        createdAt: { gte: weekStart, lt: weekEnd },
      },
    }),
  ]);

  return {
    capaOpened,
    capaClosed,
    lossCount: lossSum._count.id ?? 0,
    lossRub: lossSum._sum.costRub ?? 0,
    totalEntries: fieldEntries + docEntries,
    closedDayOverrides: overrideCount,
  };
}

async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;

  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(weekEnd);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);

  const orgs = await db.organization.findMany({
    where: {
      subscriptionPlan: { notIn: ["paused", "cancelled"] },
      ...NOT_DIRECTORY_ORG_WHERE,
    },
    select: { id: true, name: true },
  });

  let sent = 0;
  let errors = 0;

  for (const org of orgs) {
    const ctx = await buildContext(org.id, weekStart, weekEnd);
    if (ctx.totalEntries === 0 && ctx.capaOpened === 0) {
      // Org без активности — нет смысла слать narrative.
      continue;
    }

    const userPrompt =
      `Период: ${weekStart.toISOString().slice(0, 10)} — ${weekEnd
        .toISOString()
        .slice(0, 10)}\n\n` +
      `Организация: ${org.name}\n` +
      `Статистика недели:\n` +
      `- Записей в журналах: ${ctx.totalEntries}\n` +
      `- CAPA открыто: ${ctx.capaOpened}\n` +
      `- CAPA закрыто: ${ctx.capaClosed}\n` +
      `- Потерь зафиксировано: ${ctx.lossCount} (на сумму ${ctx.lossRub.toLocaleString("ru-RU")} ₽)\n` +
      `- Override'ов «закрытого дня»: ${ctx.closedDayOverrides}`;

    try {
      // AI-запрос уходит в очередь диспетчера ProjectsFlow — сайт к LLM
      // не ходит (см. src/lib/ai-assistant/pf-client.ts). Cron никуда не
      // спешит, поэтому ждём каждый ответ последовательно.
      const result = await enqueueAndWait(
        [
          "type: wesetup_weekly_digest",
          "---",
          SYSTEM_PROMPT,
          "---",
          userPrompt,
        ].join("\n")
      );
      if (!result.ok) {
        if (result.code === "not_configured") {
          return NextResponse.json({
            ok: true,
            skipped: "assistant integration not configured",
            sent,
            errors,
          });
        }
        errors += 1;
        console.warn(`[weekly-ai-digest] org ${org.id} failed: ${result.error}`);
        continue;
      }
      const narrative = result.text;
      if (!narrative.trim()) continue;

      const message =
        `🤖 <b>AI-сводка за неделю</b>\n\n` + narrative;

      await notifyOrganization(org.id, message, ["owner"]);
      sent += 1;
    } catch (err) {
      errors += 1;
      console.warn(
        `[weekly-ai-digest] org ${org.id} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return NextResponse.json({
    ok: true,
    organizationsScanned: orgs.length,
    sent,
    errors,
  });
}

export const GET = handle;
export const POST = handle;
