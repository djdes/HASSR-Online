import { NextResponse } from "next/server";
import { checkCronSecret } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/platform-alerts";
import { expirePointAssignments } from "@/lib/point-assignments.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/point-assignments?secret=$CRON_SECRET
 *
 * Автовозврат с временной точки (замена): у назначений, чей срок вышел,
 * точки сотрудника возвращаются как были. Отдельной строки в crontab не
 * требует — тот же вызов делает `/api/cron/deviation-escalations` (каждые
 * 5 минут) и страницы «Сотрудники», точки и QR точки. Маршрут — для
 * ручного прогона и на случай отдельного расписания. Идемпотентно.
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  try {
    const result = await expirePointAssignments();
    await recordCronRun({ job: "point-assignments", ok: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordCronRun({ job: "point-assignments", ok: false, error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
