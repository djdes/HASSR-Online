import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { syncAvitoChat } from "@/lib/avito/sync.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/avito/webhook/:secret — вебхук мессенджера Авито (v3).
 * Подписи у Авито нет, поэтому адрес содержит секрет AVITO_WEBHOOK_SECRET.
 * Авито ждёт 200 за 2 секунды — отвечаем сразу, чат дочитываем в фоне;
 * пропущенное подберёт шаг «Авито» цикла CRM раз в 5 минут.
 */
function secretOk(given: string): boolean {
  const expected = process.env.AVITO_WEBHOOK_SECRET?.trim() ?? "";
  if (!expected || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export async function POST(request: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  if (!secretOk(secret)) return new NextResponse("Not found", { status: 404 });
  const event = (await request.json().catch(() => null)) as { payload?: { type?: string; value?: { chat_id?: string } } } | null;
  const chatId = event?.payload?.value?.chat_id;
  if (event?.payload?.type === "message" && typeof chatId === "string" && chatId) {
    void syncAvitoChat(chatId).catch((error) => console.error("[avito] webhook sync failed", error instanceof Error ? error.message : error));
  }
  return NextResponse.json({ ok: true });
}
