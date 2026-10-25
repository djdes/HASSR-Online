import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { healthBuildSha } from "@/lib/build-version";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Публичный health-endpoint для UptimeRobot / cron-job.org / любого
 * внешнего monitor'а. Без auth — только проверка живости + БД.
 *
 * Возвращает:
 *   200 { ok: true, db: "ok", buildSha, buildShaOnDisk?, uptimeSec } — всё хорошо;
 *       `buildShaOnDisk` — только когда `.build-sha` не совпадает с работающей
 *       сборкой (деплой идёт или упал)
 *   503 { ok: false, db: "fail", ... }            — БД недоступна
 *
 * НЕ заменяет /api/external/healthz который проверяет integrations
 * (token-auth required).
 */
const startedAt = Date.now();

export async function GET() {
  let dbOk = true;
  let dbLatencyMs = 0;
  try {
    const t0 = Date.now();
    await db.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - t0;
  } catch {
    dbOk = false;
  }

  // Версия — вшитая в сборку (как у /api/build-info). `.build-sha`
  // деплой пишет в начале, поэтому он лишь запасной вариант и отдельное
  // поле, если расходится с работающей сборкой (идёт или упал деплой).
  let fileSha: string | null = null;
  try {
    fileSha = (await readFile(".build-sha", "utf-8")).trim();
  } catch {
    /* file not present */
  }
  const build = healthBuildSha({ baked: process.env.NEXT_PUBLIC_BUILD_ID, env: process.env.BUILD_SHA, file: fileSha });
  const uptimeSec = Math.round((Date.now() - startedAt) / 1000);

  const status = dbOk ? 200 : 503;
  return NextResponse.json(
    {
      ok: dbOk,
      db: dbOk ? "ok" : "fail",
      dbLatencyMs,
      ...build,
      uptimeSec,
      now: new Date().toISOString(),
    },
    { status }
  );
}
