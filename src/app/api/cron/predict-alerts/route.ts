import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import { predictComplianceForecast } from "@/lib/compliance-predict";
import { notifyOrganization } from "@/lib/telegram";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/predict-alerts?secret=$CRON_SECRET
 *
 * Дёргается раз в час 11:00-15:00 MSK. Для каждой active org прогоняет
 * `predictComplianceForecast` и шлёт push если level=critical (>=70%
 * вероятность не дойти до 80%). Дедупликация: один push на org в день.
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);

  const orgs = await db.organization.findMany({
    where: { subscriptionPlan: { notIn: ["paused", "cancelled"] }, ...NOT_DIRECTORY_ORG_WHERE },
    select: { id: true, name: true },
  });

  let pinged = 0;
  let skipped = 0;
  for (const org of orgs) {
    const forecast = await predictComplianceForecast(org.id, now);
    if (forecast.level !== "critical") {
      skipped += 1;
      continue;
    }

    // Дедупликация: один push на org в день.
    const existing = await db.auditLog.findFirst({
      where: {
        organizationId: org.id,
        action: "predict.compliance_alert",
        createdAt: { gte: new Date(`${todayKey}T00:00:00.000Z`) },
      },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const message =
      `⚠️ <b>Compliance под угрозой</b>\n\n` +
      `Сегодня к этому часу заполнено <b>${forecast.todaySoFar}</b> записей. ` +
      `В обычный день к этому часу — <b>${forecast.historicalAvgAtHour}</b>.\n\n` +
      forecast.hint;

    await notifyOrganization(org.id, message, ["owner"]);
    await db.auditLog.create({
      data: {
        organizationId: org.id,
        action: "predict.compliance_alert",
        entity: "organization",
        entityId: org.id,
        details: {
          riskScore: forecast.riskScore,
          todaySoFar: forecast.todaySoFar,
          historicalAvgAtHour: forecast.historicalAvgAtHour,
        },
      },
    });
    pinged += 1;
  }

  return NextResponse.json({
    ok: true,
    organizationsScanned: orgs.length,
    pinged,
    skipped,
  });
}

export const GET = handle;
export const POST = handle;
