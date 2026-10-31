import { NextResponse } from "next/server";

import { checkCronSecret } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import {
  UNANSWERED_AFTER_MS,
  UNANSWERED_GIVE_UP_MS,
  composeUnansweredPing,
  needsUnansweredPing,
  unansweredPingKey,
} from "@/lib/support-unanswered";
import { previewOf } from "@/lib/support-threads-shared";
import { escapeTelegramHtml } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXTAUTH_URL || "https://wesetup.ru";

/**
 * GET/POST /api/cron/support-unanswered — повторный сигнал админу в Telegram,
 * если сообщение клиента в чате поддержки без ответа 15 минут (и не дольше
 * суток). Один сигнал на одно сообщение клиента (`dedupeKey`).
 *
 * Crontab (каждые 5 минут):
 *   0-59/5 * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://wesetup.ru/api/cron/support-unanswered
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const now = new Date();
  const threads = await db.supportThread.findMany({
    where: {
      unreadForStaff: { gt: 0 },
      lastMessageAt: {
        gte: new Date(now.getTime() - UNANSWERED_GIVE_UP_MS),
        lte: new Date(now.getTime() - UNANSWERED_AFTER_MS),
      },
    },
    select: {
      id: true,
      userName: true,
      userEmail: true,
      organizationName: true,
      phone: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, author: true, body: true, createdAt: true, attachments: true },
      },
    },
    take: 200,
  });
  let pinged = 0;
  for (const thread of threads) {
    const last = thread.messages[0];
    if (!last || !needsUnansweredPing({ lastAuthor: last.author, lastMessageAt: last.createdAt }, now)) continue;
    // `notifyPlatformAdmin` сам повтор не отсекает (dedupeKey только пишется
    // в журнал), а крон идёт каждые 5 минут: уже отправленное — пропускаем.
    const dedupeKey = unansweredPingKey(last.id);
    // Сигнал мог уйти только после сообщения клиента — окно по времени
    // держит запрос на индексе (status, createdAt).
    const already = await db.telegramLog.findFirst({
      where: { status: "sent", createdAt: { gte: last.createdAt }, dedupeKey },
      select: { id: true },
    });
    if (already) continue;
    const attachments = Array.isArray(last.attachments) ? last.attachments.length : 0;
    const sent = await notifyPlatformAdmin(
      composeUnansweredPing({
        threadId: thread.id,
        preview: previewOf(last.body, attachments, 200),
        minutes: Math.floor((now.getTime() - last.createdAt.getTime()) / 60_000),
        userName: thread.userName,
        userEmail: thread.userEmail,
        organizationName: thread.organizationName,
        phone: thread.phone,
        escape: escapeTelegramHtml,
        appUrl: APP_URL,
      }),
      { kind: "support_unanswered", dedupeKey },
    ).catch((error: unknown) => {
      console.error("[support-unanswered] admin ping failed", { thread: thread.id, error });
      return false;
    });
    if (sent) pinged += 1;
  }
  return NextResponse.json({ ok: true, scanned: threads.length, pinged });
}

export const GET = handle;
export const POST = handle;
