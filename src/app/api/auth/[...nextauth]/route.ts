import NextAuth from "next-auth";
import type { NextRequest } from "next/server";

import { authOptions } from "@/lib/auth";
import { withOnlyCurrentSessionCookie } from "@/lib/auth-cookies";

const nextAuthHandler = NextAuth(authOptions);

type RouteContext = { params: Promise<{ nextauth: string[] }> };

/**
 * next-auth знает одну свою куку сессии. Вход через него (Telegram в
 * мини-приложении), обновление сессии и `signOut` пишут только её —
 * поэтому, когда ответ её ставит или гасит, остальные имена сессии гасим
 * тоже (`withOnlyCurrentSessionCookie`): после входа не остаётся куки
 * прежнего аккаунта, после выхода — запасной куки, по которой человек
 * снова оказался бы в аккаунте.
 */
async function handler(req: NextRequest, context: RouteContext): Promise<Response> {
  const response: Response = await nextAuthHandler(req, context);
  return withOnlyCurrentSessionCookie(response);
}

export { handler as GET, handler as POST };
