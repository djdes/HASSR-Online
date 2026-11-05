import { NextResponse } from "next/server";

import { checkCronSecret } from "@/lib/cron-auth";
import { publishDuePosts } from "@/lib/max/channel.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/max-channel — публикует запланированные посты в
 * канал MAX (ROOT → «Канал MAX»). Повторный запуск безопасен: пост
 * захватывается статусом «sending» и уходит один раз.
 *
 * Crontab (раз в минуту):
 *   * * * * * curl -s -m 55 -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3002/api/cron/max-channel
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  try {
    return NextResponse.json({ ok: true, ...(await publishDuePosts()) });
  } catch (error) {
    console.error("[max-channel] cron pass failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ ok: false, error: "pass failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
