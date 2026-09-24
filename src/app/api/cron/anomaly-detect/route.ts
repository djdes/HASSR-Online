import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import { notifyOrganization, escapeTelegramHtml as esc } from "@/lib/telegram";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * L2 — Anomaly detection. Раз в день для каждой active org:
 *   1. Считаем sum(costRub) потерь за сегодня.
 *   2. Сравниваем с rolling-7d-mean ± 2σ.
 *   3. Если today > mean + 2σ → push «потери выше нормы в N раз».
 *
 * Простая baseline-стат-модель без ML. Помогает заметить «сегодня
 * списали 50 000 ₽, а средне — 5 000 ₽».
 *
 * INFRA NEXT: cron 23:00 MSK ежедневно.
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const since7 = new Date(todayStart);
  since7.setUTCDate(since7.getUTCDate() - 7);

  const orgs = await db.organization.findMany({
    where: { subscriptionPlan: { notIn: ["paused", "cancelled"] }, ...NOT_DIRECTORY_ORG_WHERE },
    select: { id: true, name: true },
  });

  let alerted = 0;
  for (const org of orgs) {
    const [todayLosses, hist7Losses] = await Promise.all([
      db.lossRecord.findMany({
        where: { organizationId: org.id, date: { gte: todayStart } },
        select: { costRub: true },
      }),
      db.lossRecord.findMany({
        where: {
          organizationId: org.id,
          date: { gte: since7, lt: todayStart },
        },
        select: { costRub: true, date: true },
      }),
    ]);

    const todaySum = todayLosses.reduce((s, r) => s + (r.costRub ?? 0), 0);
    if (todaySum === 0) continue;

    // Rolling-7 mean per day.
    const dailyTotals = new Map<string, number>();
    for (const r of hist7Losses) {
      const dayKey = r.date.toISOString().slice(0, 10);
      dailyTotals.set(
        dayKey,
        (dailyTotals.get(dayKey) ?? 0) + (r.costRub ?? 0)
      );
    }
    const totals = [...dailyTotals.values()];
    if (totals.length < 3) continue; // не хватает данных

    const mean = totals.reduce((s, n) => s + n, 0) / totals.length;
    const variance =
      totals.reduce((s, n) => s + Math.pow(n - mean, 2), 0) / totals.length;
    const std = Math.sqrt(variance);
    const threshold = mean + 2 * std;

    if (todaySum < threshold) continue;

    // Дедупликация: уже пинговали сегодня?
    const existing = await db.auditLog.findFirst({
      where: {
        organizationId: org.id,
        action: "anomaly.losses_high",
        createdAt: { gte: todayStart },
      },
      select: { id: true },
    });
    if (existing) continue;

    const ratio = mean === 0 ? Infinity : todaySum / mean;
    const message =
      `📊 <b>Аномалия: потери выше нормы</b>\n\n` +
      `Сегодня: <b>${todaySum.toLocaleString("ru-RU")} ₽</b>\n` +
      `Норма (среднее за 7 дней): ${Math.round(mean).toLocaleString("ru-RU")} ₽\n` +
      `Превышение: <b>×${ratio.toFixed(1)}</b>\n\n` +
      `Проверьте свежие записи в /losses — возможно крупная партия списана или ошибка ввода (лишний 0 в costRub).`;

    await notifyOrganization(org.id, message, ["owner"]);
    await db.auditLog.create({
      data: {
        organizationId: org.id,
        action: "anomaly.losses_high",
        entity: "loss_record",
        details: {
          todaySum,
          mean: Math.round(mean),
          std: Math.round(std),
          ratio: Number(ratio.toFixed(1)),
          recordCount: todayLosses.length,
        },
      },
    });
    alerted += 1;
  }
  void esc; // зарезервировано если расширим message

  return NextResponse.json({
    ok: true,
    organizationsScanned: orgs.length,
    alerted,
  });
}

export const GET = handle;
export const POST = handle;
