import { NextResponse } from "next/server";

import { checkCronSecret } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { HrSyncError, runHrConnection } from "@/lib/hr1c/sync.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ADVISORY_LOCK_KEY = 9523873;

/**
 * GET /api/cron/hr1c-sync (CRON_SECRET) — применить изменения из 1С:ЗУП
 * (OData) у организаций с включённым автоприменением.
 *
 * Внешнее расписание (crontab на сервере, как соседние строки), раз в час:
 *   7 * * * * curl -s -m 290 -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1:3002/api/cron/hr1c-sync >/dev/null
 */
export async function GET(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const [{ locked }] = await db.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS locked`;
  if (!locked) return NextResponse.json({ ok: true, skipped: "another_tick_running" });
  try {
    const connections = await db.hrConnection.findMany({
      where: { autoApply: true, odataUrl: { not: null } },
      select: { organizationId: true },
    });
    let applied = 0;
    let failed = 0;
    for (const connection of connections) {
      try {
        await runHrConnection(connection.organizationId, "apply");
        applied += 1;
      } catch (error) {
        if (!(error instanceof HrSyncError)) console.error("[hr1c] cron failed", error);
        failed += 1;
      }
    }
    return NextResponse.json({ ok: true, applied, failed });
  } finally {
    await db.$queryRaw`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
  }
}
