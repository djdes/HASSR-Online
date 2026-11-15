import { NextResponse } from "next/server";

import { checkCronSecret } from "@/lib/cron-auth";
import { runScheduledSberSync } from "@/lib/sber/invoice-payments.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/sber-payments — сверка выписки СберБизнес со счетами
 * (src/lib/sber/invoice-payments.server.ts): оплаченные счета отмечаются сами.
 *
 * Crontab — каждые 5 минут; сверка идёт, только если автосверка включена
 * и прошёл интервал из ROOT → «СберБизнес» (src/lib/sber/schedule.ts):
 *   3-59/5 * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3002/api/cron/sber-payments
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const result = await runScheduledSberSync();
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
