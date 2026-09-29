import { NextResponse } from "next/server";

import { unsubscribeByToken } from "@/lib/mailing/public.server";
import { relativeRedirect } from "@/lib/relative-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Отписка без входа по токену из письма.
 *
 *   • POST — и кнопка на странице `/unsubscribe/<token>`, и «один клик»
 *     почтового сервиса по заголовкам `List-Unsubscribe` +
 *     `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058):
 *     почта шлёт POST с телом `List-Unsubscribe=One-Click` без страницы;
 *   • GET — на страницу с кнопкой: переход по ссылке ничего не меняет
 *     (почтовые сканеры открывают ссылки сами).
 *
 * Служебные письма отписка не трогает.
 */
function tokenOf(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const oneClick = (request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
  const result = await unsubscribeByToken(tokenOf(token), oneClick ? "one-click" : "page", request);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Ссылка недействительна" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, email: result.maskedEmail });
}

export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return relativeRedirect(`/unsubscribe/${encodeURIComponent(tokenOf(token))}`);
}
