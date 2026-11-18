import { NextResponse } from "next/server";

import { checkCronSecret } from "@/lib/cron-auth";
import { runCrmCycle } from "@/lib/crm/cycle.server";
import { sendBlankFollowups } from "@/lib/blank-followup.server";
import { autoRequestReviews } from "@/lib/review-requests.server";

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
  // Письмо через сутки после скачивания шаблона (conversion-pack-2026-11).
  // Сбой письма не роняет прогон CRM.
  const followups = await sendBlankFollowups().catch((error) => {
    console.error("[crm-cron] blank followups failed", error);
    return null;
  });
  // Автозапрос отзывов — раз в день утром, по правилам кнопки ROOT.
  const reviews = await autoRequestReviews().catch((error) => {
    console.error("[crm-cron] review requests failed", error);
    return null;
  });
  return NextResponse.json({ ...result, followups, reviews }, { status: result.ok ? 200 : 500 });
}

export const GET = handle;
export const POST = handle;
