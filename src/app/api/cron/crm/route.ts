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
 * Крон раз в 5 минут ставит деплой (scripts/install-crm-cron.sh →
 * scripts/cron-crm.sh). Шаг упал — 500: строка crontab запишет сбой в лог.
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const result = await runCrmCycle("cron");
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = handle;
export const POST = handle;
