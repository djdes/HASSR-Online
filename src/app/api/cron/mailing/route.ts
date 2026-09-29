import { NextResponse } from "next/server";

import { checkCronSecret } from "@/lib/cron-auth";
import { processMailingQueue } from "@/lib/mailing/worker.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/mailing — проход очереди рассылки ROOT: запуск
 * запланированных, `prepare` шаблонов, отправка с лимитом писем в минуту
 * и в сутки (ROOT → «Рассылка»), повторы временных сбоев, завершение.
 * Повторный запуск безопасен: канал получателя уходит один раз.
 *
 * Crontab (раз в минуту):
 *   * * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3002/api/cron/mailing
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  try {
    const result = await processMailingQueue("cron");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[mailing] cron pass failed", error);
    return NextResponse.json({ ok: false, error: "queue pass failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
