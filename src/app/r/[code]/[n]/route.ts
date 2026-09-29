import { NextResponse } from "next/server";

import { registerClick } from "@/lib/mailing/public.server";
import { relativeRedirect } from "@/lib/relative-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/r/<token>/<n>` — клик по ссылке из рассылки (ROOT → «Рассылка»).
 *
 * Отмечает `clickedAt` получателя и ведёт на n-ю ссылку из списка,
 * сохранённого при подготовке письма. Адреса в параметрах нет — увести
 * отсюда на чужой сайт нельзя. Неизвестный токен или номер — на главную.
 * (`/r/<code>` одним сегментом — реферальная ссылка, это другой маршрут.)
 */
export async function GET(_request: Request, ctx: { params: Promise<{ code: string; n: string }> }) {
  const { code, n } = await ctx.params;
  let token = code;
  try {
    token = decodeURIComponent(code);
  } catch {
    // оставляем как есть
  }
  const url = await registerClick(token, n);
  if (!url) return relativeRedirect("/");
  if (url.startsWith("/")) return relativeRedirect(url);
  return new NextResponse(null, { status: 307, headers: { Location: url, "Cache-Control": "no-store" } });
}
