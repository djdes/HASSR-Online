import { NextResponse } from "next/server";

import { checkCronSecret } from "@/lib/cron-auth";
import { runCrmCycle } from "@/lib/crm/cycle.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET/POST /api/cron/crm — прогон CRM (src/lib/crm/cycle.server.ts):
 * обращения сайта, почта IMAP, напоминания РОП и утренняя сводка.
 *
 * Crontab (каждые 5 минут):
 *   2-59/5 * * * * curl -s -m 280 -H "Authorization: Bearer $CRON_SECRET" https://wesetup.ru/api/cron/crm
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const result = await runCrmCycle("cron");
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
