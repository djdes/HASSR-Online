import { NextResponse } from "next/server";

import { checkCronSecret } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { syncSupplyConnection } from "@/lib/supply/sync.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ADVISORY_LOCK_KEY = 9523861;
/** Подключение, которое проверяли недавно (кнопкой или при открытии входящих), пропускаем. */
const MIN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * GET /api/cron/edo-sync (CRON_SECRET) — новые УПД из Диадока и СБИС и
 * данные iiko по всем подключениям. Без расписания накладные всё равно
 * приходят: при открытии «Входящих накладных» и кнопкой «Проверить новые».
 *
 * Внешнее расписание (crontab на сервере, как соседние строки):
 *   *\/15 * * * * curl -s -m 290 -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1:3002/api/cron/edo-sync >/dev/null
 */
export async function GET(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const [{ locked }] = await db.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS locked`;
  if (!locked) return NextResponse.json({ ok: true, skipped: "another_tick_running" });
  try {
    const now = new Date();
    const connections = await db.supplyConnection.findMany({ select: { id: true, lastSyncAt: true } });
    let created = 0;
    let failed = 0;
    let checked = 0;
    for (const connection of connections) {
      if (connection.lastSyncAt && now.getTime() - connection.lastSyncAt.getTime() < MIN_INTERVAL_MS) continue;
      const result = await syncSupplyConnection(connection.id, { now });
      checked += 1;
      created += result?.created ?? 0;
      if (result && !result.ok) failed += 1;
    }
    return NextResponse.json({ ok: true, checked, created, failedConnections: failed });
  } finally {
    await db.$queryRaw`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
  }
}
