import { NextResponse } from "next/server";

import { checkCronSecret } from "@/lib/cron-auth";
import { runGglCronPass } from "@/lib/seo/gogetlinks-cron.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET/POST /api/cron/gogetlinks — синхронизирует кабинет GoGetLinks
 * (баланс, кампании, статусы заявок, чаты с вебмастерами), перерабатывает
 * отклонённые заявки по слотам, раскладывает слоты на 30 дней и готовит
 * черновики доноров и статей на ближайшие 7 дней без автосписаний.
 *
 * Crontab (раз в 10 минут):
 *   *\/10 * * * * curl -s -m 110 -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3002/api/cron/gogetlinks
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  try {
    return NextResponse.json({ ok: true, ...(await runGglCronPass()) });
  } catch (error) {
    console.error(
      "[gogetlinks-cron] cron pass failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return NextResponse.json({ ok: false, error: "pass failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
