import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/avito/callback — Redirect URL приложения «WeSetup CRM»
 * в кабинете Авито. Свой аккаунт подключён по client_credentials, вход через
 * Авито не используется — адрес просто отвечает, что всё в порядке.
 */
export function GET() {
  return new NextResponse("Авито подключено к WeSetup. Окно можно закрыть.", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
